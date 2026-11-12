"""The loader's ready-made readers (Claude's read.bigquery / governed / snowflake / databricks), run under Node."""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
NODE = shutil.which("node")

HARNESS = r"""
global.window = {};
require(process.argv[1]);
const calls = [];
const replies = JSON.parse(process.argv[2]);
const call = async (tool, args) => { calls.push({ tool, args }); return replies[tool]; };
const read = window.dashReads({ call, args: { projectId: 'p1' }, poll: process.argv[4] ? JSON.parse(process.argv[4]) : null });
(async () => {
  const out = {};
  for (const [name, answer] of Object.entries(JSON.parse(process.argv[3]))) {
    try { out[name] = await read[name.split(':')[0]](answer); } catch (e) { out[name] = { error: e.message, meta: e.meta }; }
  }
  console.log(JSON.stringify({ out, calls }));
})();
"""


@unittest.skipIf(NODE is None, "node not installed")
class ReadsTests(unittest.TestCase):
    def run_reads(self, answers, replies=None, poll=None):
        r = subprocess.run([NODE, "-e", HARNESS, str(PLUGIN / "hermes_artifacts" / "types" / "dashboard" / "reads.js"),
                            json.dumps(replies or {}), json.dumps(answers)] + ([json.dumps(poll)] if poll else []),
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return json.loads(r.stdout)

    def test_bigquery_waits_for_a_running_job(self):
        done = {"jobComplete": True, "jobReference": {"projectId": "p1", "jobId": "j1", "location": "EU"}, "totalRows": "3",
                "schema": {"fields": [{"name": "day", "type": "DATE"}, {"name": "n", "type": "INTEGER"}]},
                "rows": [{"f": [{"v": "2026-11-01"}, {"v": "12"}]}, {"f": [{"v": "2026-11-02"}, {"v": "9007199254740993"}]}]}
        r = self.run_reads({"bigquery": {"jobComplete": False, "jobReference": {"jobId": "j1", "location": "EU"}}},
                           {"get_query_results": done})
        b = r["out"]["bigquery"]
        self.assertEqual(b["data"], [{"day": "2026-11-01", "n": 12}, {"day": "2026-11-02", "n": "9007199254740993"}])
        self.assertTrue(b["cut"])
        self.assertEqual(b["meta"], [{"label": "Job", "value": "p1:EU.j1"}])
        self.assertEqual(r["calls"][0]["tool"], "get_query_results")
        self.assertEqual(r["calls"][0]["args"]["jobId"], "j1")

    def test_a_stored_poll_call_sends_its_own_args_filled_from_the_answer(self):
        # The server accepts only the stored poll.args (with {{answer.…}} filled): the readers send exactly those.
        done = {"jobComplete": True, "schema": {"fields": [{"name": "n", "type": "INTEGER"}]}, "rows": [{"f": [{"v": "1"}]}]}
        poll = {"tool": "mcp_bq_get_query_results", "args": {"jobId": "{{answer.jobReference.jobId}}", "timeoutMs": 20000}}
        r = self.run_reads({"bigquery": {"jobComplete": False, "jobReference": {"jobId": "j7", "location": "EU"}}},
                           {"get_query_results": done}, poll)
        self.assertEqual(r["calls"], [{"tool": "get_query_results", "args": {"jobId": "j7", "timeoutMs": 20000}}])
        dbx_done = {"statement_id": "s1", "status": {"state": "SUCCEEDED"}, "manifest": {"schema": {"columns": [{"name": "a", "type_name": "INT"}]}},
                    "result": {"data_array": [["5"]]}}
        r = self.run_reads({"databricks": {"statement_id": "s1", "status": {"state": "RUNNING"}}}, {"poll_sql_result": dbx_done},
                           {"tool": "mcp_dbx_poll_sql_result", "args": {"statement_id": "{{answer.statement_id}}"}})
        self.assertEqual(r["calls"], [{"tool": "poll_sql_result", "args": {"statement_id": "s1"}}])

    def test_bigquery_error_in_the_connectors_words(self):
        r = self.run_reads({"bigquery": {"error": {"message": "Access Denied"}}})
        self.assertEqual(r["out"]["bigquery"]["error"], "Access Denied")

    def test_snowflake_and_databricks(self):
        sf = {"query_id": "q9", "result_set": {"resultSetMetaData": {"numRows": 1, "rowType": [{"name": "plan", "type": "text"}, {"name": "n", "type": "fixed"}, {"name": "x", "type": "fixed"}]},
                                            "data": [["pro", "7", ""]]}}
        dbx_running = {"statement_id": "s1", "status": {"state": "RUNNING"}}
        dbx_done = {"statement_id": "s1", "status": {"state": "SUCCEEDED"}, "manifest": {"schema": {"columns": [{"name": "a", "type_name": "INT"}]}, "total_row_count": 1},
                    "result": {"data_array": [["5"]]}}
        r = self.run_reads({"snowflake": sf, "databricks": dbx_running}, {"poll_sql_result": dbx_done})
        self.assertEqual(r["out"]["snowflake"]["data"], [{"plan": "pro", "n": 7, "x": None}])
        self.assertEqual(r["out"]["snowflake"]["meta"], [{"label": "Query ID", "value": "q9"}])
        self.assertEqual(r["out"]["databricks"]["data"], [{"a": 5}])
        self.assertEqual(r["calls"], [{"tool": "poll_sql_result", "args": {"statement_id": "s1"}}])

    def test_governed_xml(self):
        xml = ('<query_result bytes_processed="2048"><compiled_sql>SELECT 1</compiled_sql><results total_rows="1">'
               '<column name="k" type="STRING"/><column name="v" type="INT64"/>'
               '<row><field name="k">a &amp; b</field><field name="v">3</field></row></results></query_result>')
        r = self.run_reads({"governed": xml, "governed:err": '<query_result><error>Bad SQL</error></query_result>'})
        g = r["out"]["governed"]
        self.assertEqual(g["data"], [{"k": "a & b", "v": 3}])
        self.assertEqual(g["meta"][0], {"label": "SQL", "value": "SELECT 1", "type": "code", "lang": "sql"})
        self.assertEqual(r["out"]["governed:err"]["error"], "Bad SQL")


if __name__ == "__main__":
    unittest.main()
