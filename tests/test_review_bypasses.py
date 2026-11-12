"""Regression tests for the bypasses an adversarial review of the plugin-catalog fixes found: a prompt-
injected agent (hostile tool args, a hostile dashboard.json) and hostile page JS must not get past them.

A: a chat whose working directory is home (or above it, or a drive root) has no project folder; hidden
   or system entries, hard links and oversized folders are refused or skipped while copying.
B: a page's loader call() sends only the approved args; the SQL guard fails closed.
C: only calls Hermes reports as status "ok" count as ran.
D: a pattern does not pin a hole; SQL text holes are never spliced raw.
E: the host dialog approves only a call it showed in full.
F: poll args are matched too.
H: no private Hermes import; the server comes from the configured names.
"""

import argparse
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import live, store  # noqa: E402
from test_live import FakeCtx, use_ctx  # noqa: E402
from test_security import EXAMPLE_DS, load_plugin  # noqa: E402

NODE = shutil.which("node")


def set_attrs(p: Path, attrs: int) -> bool:
    """Windows file attributes (2 hidden, 4 system); False where there are none."""
    if os.name != "nt":
        return False
    import ctypes
    return bool(ctypes.windll.kernel32.SetFileAttributesW(str(p), attrs))


# ----------------------------------------------------------------------------- A

class HomeIsNoProjectTests(unittest.TestCase):
    """A faked home (USERPROFILE/HOME in a temp dir): never the real one."""

    def setUp(self):
        self.p = load_plugin()
        self.t = Path(tempfile.mkdtemp(prefix="rv-home-"))
        self.home = self.t / "home"
        self.startup = self.home / "AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup"
        self.startup.mkdir(parents=True)
        (self.startup / "desktop.ini").write_text("[x]", "utf-8")
        cred = self.home / "AppData/Roaming/GitHub CLI"
        cred.mkdir(parents=True)
        (cred / "hosts.yml").write_text("oauth_token: FAKE", "utf-8")
        env = mock.patch.dict(os.environ, {"USERPROFILE": str(self.home), "HOME": str(self.home)})
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(shutil.rmtree, self.t, True)
        self.ds = store.publish(path=str(EXAMPLE_DS), title="Kiln", type="design-system")["id"]

    def cwd(self, d):
        self.p._ctx = types.SimpleNamespace(session_cwd=lambda: str(d))
        self.addCleanup(setattr, self.p, "_ctx", None)

    def test_home_as_cwd_reads_nothing(self):
        self.cwd(self.home)
        before = {m["id"] for m in store.list_all()}
        r = json.loads(self.p._publish({"path": "AppData/Roaming/GitHub CLI/hosts.yml", "title": "x", "open": False}))
        self.assertFalse(r["ok"])
        self.assertEqual(r["code"], "path_refused")
        self.assertIn("no project folder", r["error"])
        self.assertIn("Next: ", r["error"])
        self.assertEqual({m["id"] for m in store.list_all()}, before)

    def test_home_as_cwd_writes_nothing(self):
        self.cwd(self.home)
        r = json.loads(self.p._ds_export({"id": self.ds, "overwrite": True,
                                          "dir": "AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup"}))
        self.assertFalse(r["ok"])
        self.assertTrue(r["error"].startswith("Nothing was written"))
        self.assertIn("no project folder", r["error"])
        self.assertEqual(sorted(x.name for x in self.startup.iterdir()), ["desktop.ini"])

    def test_above_home_and_a_drive_root_are_no_project_either(self):
        for d in (self.t, Path(self.t.anchor)):
            with self.assertRaises(store.PathRefused) as e:
                store.confine("home/AppData/Roaming/GitHub CLI/hosts.yml", d)
            self.assertTrue(e.exception.no_project)

    def test_a_project_inside_home_still_works(self):
        proj = self.home / "proj"
        proj.mkdir()
        (proj / "p.html").write_text("<p>p</p>", "utf-8")
        self.cwd(proj)
        r = json.loads(self.p._publish({"path": "p.html", "title": "x", "open": False}))
        self.assertTrue(r["ok"], r)
        r = json.loads(self.p._publish({"path": "../AppData/Roaming/GitHub CLI/hosts.yml", "title": "x", "open": False}))
        self.assertFalse(r["ok"])


class HiddenLinksAndLimitsTests(unittest.TestCase):
    def setUp(self):
        self.p = load_plugin()
        self.work = Path(tempfile.mkdtemp(prefix="work-"))
        self.outside = Path(tempfile.mkdtemp(prefix="outside-"))
        self.p._ctx = types.SimpleNamespace(session_cwd=lambda: str(self.work))
        self.addCleanup(setattr, self.p, "_ctx", None)
        self.addCleanup(shutil.rmtree, self.work, True)
        self.addCleanup(shutil.rmtree, self.outside, True)

    def publish(self, path):
        return json.loads(self.p._publish({"path": str(path), "title": "t", "open": False}))

    @unittest.skipUnless(os.name == "nt", "Windows file attributes")
    def test_hidden_and_system_attributes_are_refused_and_skipped(self):
        site = self.work / "site"
        (site / "AppData").mkdir(parents=True)
        (site / "AppData" / "secret.html").write_text("s", "utf-8")
        (site / "desktop.ini").write_text("[x]", "utf-8")
        (site / "index.html").write_text("<p>i</p>", "utf-8")
        self.assertTrue(set_attrs(site / "AppData", 2))
        self.assertTrue(set_attrs(site / "desktop.ini", 4))
        for p in (site / "AppData" / "secret.html", site / "AppData", site / "desktop.ini"):
            r = self.publish(p)
            self.assertFalse(r["ok"], p)
            self.assertIn("hidden", r["error"])
        r = self.publish(site)
        self.assertTrue(r["ok"], r)
        self.assertEqual(store.list_files(r["id"]), ["index.html"])

    def test_a_hard_link_is_refused_and_skipped(self):
        (self.outside / "secret.html").write_text("<p>secret</p>", "utf-8")
        site = self.work / "site"
        site.mkdir()
        (site / "index.html").write_text("<p>i</p>", "utf-8")
        try:
            os.link(self.outside / "secret.html", site / "hl.html")
        except OSError:
            self.skipTest("no hard links here")
        r = self.publish(site / "hl.html")
        self.assertFalse(r["ok"])
        self.assertIn("hard link", r["error"])
        r = self.publish(site)
        self.assertTrue(r["ok"], r)
        self.assertEqual(store.list_files(r["id"]), ["index.html"])

    def test_a_big_folder_fails_while_copying(self):
        big = self.work / "big"
        big.mkdir()
        for i in range(store.MAX_FILES + 50):
            (big / f"f{i:04}.txt").write_text("x", "utf-8")
        (big / "index.html").write_text("<p>i</p>", "utf-8")
        copied = []
        real = self.p.store._copy_fresh
        with mock.patch.object(self.p.store, "_copy_fresh", lambda s, d: copied.append(s) or real(s, d)):
            r = self.publish(big)
        self.assertFalse(r["ok"])
        self.assertIn(f"at most {store.MAX_FILES} files", r["error"])
        self.assertEqual(len(copied), store.MAX_FILES)

    def test_a_folder_over_16_mb_fails_before_reading_the_rest(self):
        big = self.work / "heavy"
        big.mkdir()
        for i in range(4):
            with open(big / f"b{i}.bin", "wb") as f:
                f.truncate(7 * 1024 * 1024)
        copied = []
        real = self.p.store._copy_fresh
        with mock.patch.object(self.p.store, "_copy_fresh", lambda s, d: copied.append(s) or real(s, d)):
            r = self.publish(big)
        self.assertFalse(r["ok"])
        self.assertIn("16 MB", r["error"])
        self.assertEqual(len(copied), 2)

    def test_a_store_version_still_copies_its_hard_linked_files(self):
        aid = store.publish(title="v", files={"index.html": "<p>a</p>", "b.css": "b{}"})["id"]
        store.publish(aid=aid, base=True, files={"index.html": "<p>b</p>"})  # b.css is a hard link now
        from hermes_artifacts import api
        new = api.handle("POST", f"artifacts/{aid}/duplicate", {}, {})
        self.assertEqual(sorted(store.list_files(new["id"])), ["b.css", "index.html"])


# ----------------------------------------------------------------------------- B: the guard

BYPASSES = ["; DELETE FROM users", "EXPLAIN ANALYZE DELETE FROM users", "DELETE u FROM users u",
            "UPDATE users AS u SET admin = true", "INSERT users VALUES (1)", "REPLACE INTO users VALUES (1)",
            "TRUNCATE users", "COPY users TO PROGRAM 'calc.exe'", "DO $$ BEGIN DELETE FROM users; END $$",
            "DROP USER bob", "ALTER USER bob WITH SUPERUSER", "ATTACH DATABASE 'C:/x.db' AS x",
            "(SELECT 1); DELETE FROM users", "GRANT SELECT, INSERT ON users TO bob", "VACUUM",
            "MERGE INTO t USING s ON 1=1 WHEN MATCHED THEN DELETE", "SELECT 1 FROM t; DELETE FROM users",
            "WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d", "SELECT * INTO backup FROM users",
            "-- note\nTRUNCATE users", "/* x */ DROP TABLE t", "Revenue by month\nDELETE FROM users"]
PROSE = ["delete old drafts", "update on sales", "Azure Functions", "update notes for Teams",
         "select the best Azure SKU", "copy the doc to Teams", "analyze sales trends", "explain the chart",
         "grant me access", "drop by tomorrow", "insert coin", "vacuum cleaner reviews", "truncate long names",
         "SELECT month, SUM(net) FROM orders WHERE region = 'update' GROUP BY month"]


class GuardTests(unittest.TestCase):
    pass


def _refuses(q):
    def test(self):
        with self.assertRaises(live.LiveError) as e:
            live.guard({"sql": q})
        self.assertEqual(e.exception.status, "refused")
    return test


def _passes(q):
    def test(self):
        live.guard({"query": q})
    return test


for _i, _q in enumerate(BYPASSES):
    setattr(GuardTests, f"test_refuses_{_i:02}", _refuses(_q))
for _i, _q in enumerate(PROSE):
    setattr(GuardTests, f"test_prose_passes_{_i:02}", _passes(_q))


# ----------------------------------------------------------------------------- B: call() args

SPEC = {"params": {"region": "South", "n": 5}, "datasets": {"s": {"source": {
    "kind": "call", "tool": "mcp_db_query",
    "args": {"sql": "SELECT n FROM sales WHERE region = '{{region}}' LIMIT {{n}}"},
    "rules": {"region": {"enum": ["North", "South"]}, "n": {"type": "number", "maximum": 100}},
    "poll": {"tool": "mcp_db_result", "args": {"job": "{{answer.job.id}}", "wait": 20}}}}}}


class LoaderArgsTests(unittest.TestCase):
    def setUp(self):
        self.reg = FakeCtx()
        use_ctx(self, self.reg)
        self.aid = store.publish(title="lc", type="dashboard", files={"dashboard.json": SPEC, "index.html": "x"})["id"]
        d = live.dataset(self.aid, "s")
        store.set_approval(self.aid, live._cid(d), d["tool"], True)

    def call(self, tool, args):
        return live.loader_call(self.aid, "s", tool, args)

    def test_arbitrary_args_on_the_approved_tool_are_refused(self):
        for args in ({"sql": "TRUNCATE users"}, {"sql": "SELECT secret FROM vault"},
                     {"sql": "SELECT n FROM sales WHERE region = 'South' LIMIT 5", "extra": 1},
                     {"sql": "SELECT n FROM sales WHERE region = 'Pest' LIMIT 5"},
                     {"sql": "SELECT n FROM sales WHERE region = 'South' LIMIT 5 UNION SELECT 1"}):
            r = self.call("query", args)
            self.assertEqual(r["status"], "refused", args)
        self.assertEqual(self.call("mcp_db_drop", {"x": 1})["status"], "refused")
        self.assertEqual(self.reg.calls, [])

    def test_the_stored_args_with_their_filters_filled_run(self):
        r = self.call("query", {"sql": "SELECT n FROM sales WHERE region = 'North' LIMIT 7"})
        self.assertEqual(r["status"], "ok", r)

    def test_poll_args_must_be_the_stored_ones(self):
        self.assertEqual(self.call("result", {"job": "j-1", "wait": 20})["status"], "ok")
        for args in ({"job": "j-1", "wait": 20, "drop": True}, {"job": "j-1", "wait": 0},
                     {"job": "x' OR 1=1", "wait": 20}, {"job": {"a": 1}, "wait": 20}):
            self.assertEqual(self.call("result", args)["status"], "refused", args)
        self.assertEqual(len(self.reg.calls), 1)


# ----------------------------------------------------------------------------- C, D, F

def ds(tool, args, rules=None, poll=None):
    return {"tool": tool, "args": args, "rules": rules or {}, "poll": poll}


class RecordedTests(unittest.TestCase):
    def setUp(self):
        live._RAN.clear()

    def test_only_status_ok_counts_as_ran(self):
        for st in ("error", "blocked", "cancelled", "timeout", None, "", "OK"):
            self.assertFalse(live.record_call("s", "mcp_db_query", {"sql": "SELECT 1"}, st), st)
        self.assertFalse(live.recorded_match("s", ds("mcp_db_query", {"sql": "SELECT 1"})))
        self.assertTrue(live.record_call("s", "mcp_db_query", {"sql": "SELECT 1"}, "ok"))
        self.assertTrue(live.recorded_match("s", ds("mcp_db_query", {"sql": "SELECT 1"})))

    def test_a_pattern_does_not_pin_a_hole(self):
        live.record_call("s", "mcp_slack_post_message", {"channel": "C1", "text": "hi"}, "ok")
        d = ds("mcp_slack_post_message", {"channel": "{{c}}", "text": "{{t}}"},
               {"c": {"pattern": "[\\s\\S]*"}, "t": {"pattern": "[\\s\\S]*"}})
        self.assertFalse(live.recorded_match("s", d))
        d = ds("mcp_slack_post_message", {"channel": "{{c}}", "text": "hi"}, {"c": {"enum": ["C1", "C2"]}})
        self.assertTrue(live.recorded_match("s", d))

    def test_a_sql_text_hole_with_a_pattern_waits_and_never_injects(self):
        live.record_call("s", "mcp_db_query", {"sql": "SELECT n FROM sales WHERE region = 'eu'"}, "ok")
        d = ds("mcp_db_query", {"sql": "SELECT n FROM sales WHERE region = '{{r}}'"}, {"r": {"pattern": "[\\s\\S]*"}})
        self.assertFalse(live.recorded_match("s", d))
        with self.assertRaises(live.LiveError):
            live.fill(d["args"], {"r": "x' UNION SELECT password FROM users --"}, d["rules"])
        self.assertIn("'eu'", live.fill(d["args"], {"r": "eu"}, d["rules"])["sql"])  # quote-free text inside '…'

    def test_a_raw_sql_hole_needs_an_enum_number_or_boolean(self):
        tpl = {"sql": "SELECT n FROM sales WHERE id = {{v}}"}
        with self.assertRaises(live.LiveError):
            live.fill(tpl, {"v": "1 UNION SELECT password FROM users"}, {"v": {"pattern": "[\\w ]*"}})
        with self.assertRaises(live.LiveError):
            live.fill(tpl, {"v": "1"}, {})
        self.assertIn("id = 7", live.fill(tpl, {"v": 7}, {"v": {"type": "number"}})["sql"])
        self.assertIn("id = b", live.fill(tpl, {"v": "b"}, {"v": {"enum": ["a", "b"]}})["sql"])
        with self.assertRaises(live.LiveError):  # a "…" identifier is not a literal
            live.fill({"sql": 'SELECT "{{c}}" FROM t'}, {"c": "a"}, {"c": {"pattern": "\\w+"}})

    def test_poll_args_must_match_a_call_that_ran(self):
        live.record_call("s", "mcp_db_query", {"sql": "SELECT 1"}, "ok")
        live.record_call("s", "mcp_db_admin", {"x": 1}, "ok")
        d = ds("mcp_db_query", {"sql": "SELECT 1"}, {}, {"tool": "mcp_db_admin", "args": {"drop_everything": True}})
        self.assertFalse(live.recorded_match("s", d))
        d = ds("mcp_db_query", {"sql": "SELECT 1"}, {}, {"tool": "mcp_db_admin", "args": {"x": "{{answer.n}}"}})
        self.assertTrue(live.recorded_match("s", d))
        d = ds("mcp_db_query", {"sql": "SELECT 1"}, {}, {"tool": "mcp_db_admin", "args": {"x": "{{q}}"}})
        self.assertFalse(live.recorded_match("s", d))  # a free filter hole in the poll args waits too


# ----------------------------------------------------------------------------- E

@unittest.skipIf(NODE is None, "node not installed")
class HostDialogTests(unittest.TestCase):
    """approveQueries from plugin.js, run under node with a fake dialog and server."""

    HARNESS = r"""
const src = require('fs').readFileSync(process.argv[1], 'utf8');
const start = src.indexOf('const QUERY_SHOW_MAX'), end = src.indexOf('\nfunction ConfirmSend');
const shown = [], posted = [];
const answers = JSON.parse(process.argv[3]);
const askUser = async (kind, text) => { shown.push({ kind, text }); return kind === 'query' ? answers.shift() : false; };
const enc = encodeURIComponent;
const calls = JSON.parse(process.argv[2]);
const ctx = { rest: async (url, o) => { if (o.body.allowed) { posted.push(o.body.call); return {}; } return calls[o.body.id]; } };
eval(src.slice(start, end) + '\nglobalThis.approveQueries = approveQueries;');
(async () => {
  const r = await approveQueries(ctx, 'a', Object.keys(calls).map(id => ({ id })), 1);
  console.log(JSON.stringify({ r, shown, posted }));
})();
"""

    def run_js(self, calls, answers):
        r = subprocess.run([NODE, "-e", self.HARNESS, str(PLUGIN / "desktop" / "plugin.js"), json.dumps(calls),
                            json.dumps(answers)], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def call(self, cid, sql, poll=None):
        return {"tool": "mcp_db_query", "args": {"sql": sql}, "rules": {"r": {"enum": ["a"]}}, "poll": poll,
                "call": cid, "approved": False}

    def test_one_step_per_call_shown_in_full(self):
        poll = {"tool": "mcp_db_result", "args": {"job": "{{answer.id}}"}}
        out = self.run_js({"q1": self.call("c1", "SELECT 1", poll), "q2": self.call("c2", "SELECT 2")}, [True, True])
        self.assertTrue(out["r"])
        self.assertEqual(out["posted"], ["c1", "c2"])
        self.assertEqual([s["text"]["step"] for s in out["shown"]], ["1/2", "2/2"])
        rows = dict(out["shown"][0]["text"]["rows"])
        self.assertEqual(rows["queryTool"], "mcp_db_query")
        self.assertIn("SELECT 1", rows["queryArgs"])
        self.assertEqual(rows["queryPoll"], "mcp_db_result")
        self.assertIn("{{answer.id}}", rows["queryPollArgs"])
        self.assertIn('"enum"', rows["queryRules"])

    def test_a_call_too_long_to_show_is_never_approved(self):
        out = self.run_js({"long": self.call("c-long", "SELECT 1 /*" + "x" * 9000 + "*/"),
                           "short": self.call("c-short", "SELECT 2")}, [True])
        self.assertFalse(out["r"])
        self.assertEqual(out["posted"], ["c-short"])
        self.assertEqual(out["shown"][0]["kind"], "queryLong")

    def test_cancel_approves_nothing_after_it(self):
        out = self.run_js({"q1": self.call("c1", "SELECT 1"), "q2": self.call("c2", "SELECT 2")}, [False])
        self.assertFalse(out["r"])
        self.assertEqual(out["posted"], [])

    def test_strings_in_english_and_hungarian(self):
        js = (PLUGIN / "desktop" / "plugin.js").read_text(encoding="utf-8")
        for key in ("queryLong:", "queryLongTitle:", "queryStep:", "queryPollArgs:", "queryRules:"):
            self.assertEqual(js.count("    " + key), 2, key)
        self.assertNotIn("slice(0, 8000)", js)


# ----------------------------------------------------------------------------- H

class ServerFromNameTests(unittest.TestCase):
    def setUp(self):
        saved = live._known_servers
        self.addCleanup(setattr, live, "_known_servers", saved)

    def test_no_private_registry_import(self):
        src = (PLUGIN / "hermes_artifacts" / "live.py").read_text(encoding="utf-8")
        self.assertNotIn("tools.registry", src)

    def test_configured_names_resolve_and_a_clash_resolves_to_none(self):
        live._known_servers = lambda: ["my-db", "db"]
        self.assertEqual(live.split_tool("mcp__my_db__run"), ("my-db", "run"))
        self.assertEqual(live.split_tool("mcp_my_db_run"), ("my-db", "run"))
        self.assertEqual(live.server_of("mcp__db__run"), "db")
        live._known_servers = lambda: ["foo-bar", "foo_bar"]
        self.assertIsNone(live.server_of("mcp__foo_bar__run"))
        with self.assertRaises(live.LiveError):
            live.run_tool("mcp__foo_bar__run", {})


# ----------------------------------------------------------------------------- trash

class TrashDecoyTests(unittest.TestCase):
    def test_restore_by_folder_name_picks_that_copy(self):
        p = load_plugin()
        aid = store.publish(title="Real", html="<p>real</p>")["id"]
        store.delete(aid)
        store.publish(aid=aid, title="Decoy", html="<p>decoy</p>")
        store.delete(aid)
        entries = [t for t in store.trash_list() if t["id"] == aid]
        self.assertEqual([t["title"] for t in entries], ["Decoy", "Real"])
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            p._cli(argparse.Namespace(artifacts_cmd="trash"))
        for t in entries:
            self.assertIn(t["name"], out.getvalue())
        store.restore(entries[1]["name"])
        self.assertEqual(store.get_meta(aid)["title"], "Real")
        self.assertEqual(store.read_file(aid, "index.html"), b"<p>real</p>")


if __name__ == "__main__":
    unittest.main()
