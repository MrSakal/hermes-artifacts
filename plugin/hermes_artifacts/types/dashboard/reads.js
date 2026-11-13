/* hermes-artifacts Dashboard: the ready-made answer readers a loader gets as `read`
 * (read.bigquery / read.governed / read.snowflake / read.databricks). Each returns {data, columns, cut, meta} and throws the connector's own
 * words on a failure; BigQuery's and Databricks' wait for a query left running through `call`.
 *
 *   dash.loader('signups', { description: 'BigQuery’s answer as rows', fn: ({ answer, read }) => read.bigquery(answer) });
 */
(function () {
  "use strict";
  var NOT_ROWS = "The query answered with something other than rows.";
  var NO_JOB = "The query is still running and gave no job to wait on.";
  var NO_STMT = "The query is still running and gave no statement to wait on.";
  var TOO_LONG = "The query is taking longer than usual, so this data didn’t load. Try again in a minute.";
  var obj = function (v) { return typeof v === "object" && v !== null && !Array.isArray(v); };
  var str = function (o, k) { return o && Object.prototype.hasOwnProperty.call(o, k) && typeof o[k] === "string" ? o[k] : ""; };
  var NUM = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  // A long integer (2^53 or more) stays text: Number() would lose its digits. Dates stay text.
  function exact(s) { var t = s.trim(), n = NUM.test(t) ? Number(t) : NaN; return isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : s; }
  function real(s) { return s.trim() !== "" && isFinite(Number(s)) ? Number(s) : s; }
  function bool(s) { return /^true$/i.test(s) ? true : /^false$/i.test(s) ? false : s; }
  function parse(v) { if (typeof v === "string") { var t = v.trim(); if (t[0] === "{" || t[0] === "[" || t[0] === "<") { try { return JSON.parse(t); } catch (e) {} } } return v; }
  function unwrap(answer) {
    var a = parse(answer);
    if (obj(a) && Array.isArray(a.content) && a.content[0] && typeof a.content[0].text === "string") a = parse(a.content[0].text);
    if (obj(a) && obj(a.structuredContent)) a = a.structuredContent;
    return a;
  }
  function uniq(names) {
    var seen = {};
    return names.map(function (n, i) {
      var b = n || "column_" + (i + 1), k = b, j = 2;
      while (seen[k]) k = b + "_" + j++;
      seen[k] = 1; return k;
    });
  }
  function table(cols, rowsOf, rows, type) {
    var names = uniq(cols.map(function (c) { return c.name; }));
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var cells = rowsOf(rows[i]);
      if (cells === null) return null;
      var o = {};
      for (var j = 0; j < names.length; j++) o[names[j]] = type(cols[j] ? cols[j].type : "", cells[j] === undefined ? null : cells[j]);
      out.push(o);
    }
    return { columns: names, data: out };
  }
  function fail(msg, meta) { var e = new Error(msg); e.meta = meta || []; return e; }
  function meta(list) { return list.filter(function (m) { return m && m.value !== "" && m.value != null; }); }
  function slowCheck(started) { return function () { return Date.now() - started < 14 * 60 * 1000; }; }
  // The source's stored poll args with their {{answer.…}} filled from this answer, as the server's own
  // polling fills them: call() must send exactly the stored args (the server refuses any others).
  var ANSWER_REF = /\{\{\s*answer((?:\.[A-Za-z_][\w-]*|\[\d+\])+)\s*\}\}/g;
  function answerAt(a, path) {
    var cur = a, re = /\.([A-Za-z_][\w-]*)|\[(\d+)\]/g, m;
    while ((m = re.exec(path))) {
      if (typeof cur === "string") { try { cur = JSON.parse(cur); } catch (e) { return null; } }
      cur = m[1] !== undefined ? (obj(cur) ? cur[m[1]] : null) : (Array.isArray(cur) ? cur[+m[2]] : null);
      if (cur === undefined) cur = null;
    }
    return cur;
  }
  function fillAnswer(v, a) {
    if (Array.isArray(v)) return v.map(function (x) { return fillAnswer(x, a); });
    if (obj(v)) { var o = {}; Object.keys(v).forEach(function (k) { o[k] = fillAnswer(v[k], a); }); return o; }
    if (typeof v !== "string") return v;
    var whole = new RegExp("^" + ANSWER_REF.source + "$").exec(v.trim());
    if (whole) return answerAt(a, whole[1]);
    return v.replace(ANSWER_REF, function (_, p) { var x = answerAt(a, p); return x == null || x === false || x === 0 ? "" : String(x); });
  }
  function pollArgs(ctx, a, fallback) { return ctx.poll && obj(ctx.poll.args) ? fillAnswer(ctx.poll.args, a) : fallback; }

  // --- Google Cloud BigQuery (its JSON: schema.fields, rows[].f[].v; jobComplete false = still running)
  function bqOnce(a) {
    if (Object.prototype.hasOwnProperty.call(a, "jobComplete") && a.jobComplete === false) {
      var ref = obj(a.jobReference) ? a.jobReference : {};
      return { pending: { jobId: str(a, "jobId") || str(ref, "jobId"), location: str(a, "location") || str(ref, "location") } };
    }
    var fields = obj(a.schema) && Array.isArray(a.schema.fields) ? a.schema.fields : null;
    if (!fields) return null;
    var cols = fields.map(function (c) { return obj(c) ? { name: str(c, "name"), type: str(c, "type") } : { name: "", type: "" }; });
    var t = table(cols, function (r) {
      if (Array.isArray(r)) return r;
      if (!obj(r)) return null;
      return Array.isArray(r.f) ? r.f.map(function (d) { return obj(d) && "v" in d ? d.v : null; }) : cols.map(function (c) { return r[c.name]; });
    }, Array.isArray(a.rows) ? a.rows : [], function (type, v) {
      if (typeof v !== "string") return v;
      var u = type.toUpperCase();
      if (u === "INTEGER" || u === "INT64" || u === "NUMERIC" || u === "BIGNUMERIC") return exact(v);
      if (u === "FLOAT" || u === "FLOAT64") return real(v);
      if (u === "BOOLEAN" || u === "BOOL") return bool(v);
      return v;
    });
    if (!t) return null;
    var total = typeof a.totalRows === "number" ? a.totalRows : Number(str(a, "totalRows"));
    var ref2 = obj(a.jobReference) ? a.jobReference : {};
    var job = str(ref2, "jobId");
    return { table: t, cut: str(a, "pageToken") !== "" || (isFinite(total) && total > t.data.length),
      meta: meta([{ label: "Job", value: job ? (str(ref2, "projectId") ? str(ref2, "projectId") + ":" : "") + (str(ref2, "location") ? str(ref2, "location") + "." : "") + job : "" }]) };
  }
  function bqError(a) { var e = obj(a) ? a.error : undefined; return typeof e === "string" ? e : obj(e) ? str(e, "message") : ""; }
  function bigquery(ctx) {
    return async function (answer) {
      var a = unwrap(answer), started = Date.now(), alive = slowCheck(started);
      if (!obj(a)) throw fail(NOT_ROWS);
      var err = bqError(a);
      if (err) throw fail(err);
      var r = bqOnce(a), job = null, last = a;
      if (r === null) throw fail(NOT_ROWS);
      while (r.pending) {
        if (r.pending.jobId) job = r.pending;
        if (!job) throw fail(NO_JOB);
        if (!alive()) throw fail(TOO_LONG);
        var next = await ctx.call("get_query_results", pollArgs(ctx, last, Object.assign({ jobId: job.jobId, timeoutMs: 20000 },
          ctx.args && ctx.args.projectId ? { projectId: ctx.args.projectId } : {}, job.location ? { location: job.location } : {})));
        next = last = unwrap(next);
        err = bqError(next);
        if (err) throw fail(err);
        r = obj(next) ? bqOnce(next) : null;
        if (r === null) throw fail(NOT_ROWS);
      }
      return { data: r.table.data, columns: r.table.columns, cut: r.cut, meta: r.meta };
    };
  }

  // --- a <query_result> XML answer (BigQuery's governed / semantic tools)
  function attr(tag, name) { var m = new RegExp("\\s" + name + "=\"([^\"]*)\"").exec(tag); return m ? xmlText(m[1]) : ""; }
  function xmlText(s) { return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, "&"); }
  function inner(s, tag) { var m = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">").exec(s); return m ? m[1] : null; }
  function kb(n) { n = Number(n); if (!isFinite(n) || n <= 0) return ""; var u = ["B", "KB", "MB", "GB", "TB"], i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(1) : n) + " " + u[i]; }
  function governed() {
    return function (answer) {
      var s = typeof answer === "string" ? answer : unwrap(answer);
      if (typeof s !== "string") throw fail(NOT_ROWS);
      var at = s.indexOf("<query_result"), end = s.indexOf("</query_result>", at);
      if (at < 0 || end < 0) throw fail(NOT_ROWS);
      var q = s.slice(at, end), head = /^<query_result\b[^>]*>/.exec(q);
      var m = meta([{ label: "SQL", value: xmlText(inner(s, "compiled_sql") || "").trim(), type: "code", lang: "sql" },
        { label: "Job", value: xmlText(inner(s, "job_url") || "").trim() },
        { label: "Data scanned", value: kb(attr(head ? head[0] : "", "bytes_processed")) }]);
      var err = inner(q, "error");
      if (err !== null) throw fail(xmlText(err).trim(), m);
      var res = /<results\b[^>]*>([\s\S]*?)<\/results>/.exec(q);
      if (!res) return { data: [], columns: [], cut: false, meta: m };
      var cols = [], re = /<column\b[^>]*\/?>/g, c;
      while ((c = re.exec(res[1]))) cols.push({ name: attr(c[0], "name"), type: attr(c[0], "type") });
      var rows = [], rr = /<row\b[^>]*>([\s\S]*?)<\/row>/g, r;
      while ((r = rr.exec(res[1]))) {
        var o = {}, fr = /<field\b([^>]*?)(\/>|>([\s\S]*?)<\/field>)/g, f;
        while ((f = fr.exec(r[1]))) o[attr(" " + f[1], "name")] = attr(" " + f[1], "null") === "true" ? null : xmlText(f[3] || "");
        rows.push(o);
      }
      var t = table(cols, function (row) { return cols.map(function (k) { return row[k.name]; }); }, rows, function (type, v) {
        if (typeof v !== "string") return v;
        var u = type.toUpperCase();
        if (/INT|NUMERIC/.test(u)) return exact(v);
        if (/FLOAT|DOUBLE/.test(u)) return real(v);
        if (/BOOL/.test(u)) return bool(v);
        return v;
      });
      var total = Number(attr(/<results\b[^>]*>/.exec(q)[0], "total_rows"));
      return { data: t.data, columns: t.columns, cut: isFinite(total) && total > t.data.length, meta: m };
    };
  }

  // --- a Snowflake-managed server's answer (result_set.resultSetMetaData.rowType, result_set.data)
  function snowflake() {
    return function (answer) {
      var a = unwrap(answer);
      var rs = obj(a) && obj(a.result_set) ? a.result_set : null, md = rs && obj(rs.resultSetMetaData) ? rs.resultSetMetaData : null;
      var types = md && Array.isArray(md.rowType) ? md.rowType : null;
      if (!rs || !md || !types) throw fail(NOT_ROWS);
      var cols = types.map(function (c) { return obj(c) ? { name: str(c, "name"), type: str(c, "type") } : { name: "", type: "" }; });
      var t = table(cols, function (r) { return Array.isArray(r) ? r : null; }, Array.isArray(rs.data) ? rs.data : [], function (type, v) {
        if (typeof v !== "string") return v;
        var u = type.toLowerCase();
        if (u === "text") return v;
        if (v === "") return null; // Snowflake writes a SQL NULL as "" in every column but text
        if (u === "fixed") return exact(v);
        if (u === "real") return real(v);
        if (u === "boolean") return bool(v);
        return v;
      });
      if (!t) throw fail(NOT_ROWS);
      return { data: t.data, columns: t.columns, cut: Number(md.numRows) > t.data.length,
        meta: meta([{ label: "Query ID", value: str(a, "query_id") || str(rs, "statementHandle") }]) };
    };
  }

  // --- a Databricks SQL statement (status.state, manifest.schema.columns, result.data_array)
  var DBX_STATES = { CANCELED: "The query was canceled.", CLOSED: "The query’s result is no longer kept.", FAILED: "The query failed." };
  function state(a) { return obj(a) && obj(a.status) ? str(a.status, "state") : ""; }
  function databricks(ctx) {
    return async function (answer) {
      var a = unwrap(answer), started = Date.now(), alive = slowCheck(started);
      if (!obj(a) || state(a) === "") throw fail(NOT_ROWS);
      var id = str(a, "statement_id"), m = id ? [{ label: "Statement", value: id, type: "text" }] : [];
      while (state(a) === "PENDING" || state(a) === "RUNNING") {
        if (!id) throw fail(NO_STMT);
        if (!alive()) throw fail(TOO_LONG, m);
        a = unwrap(await ctx.call("poll_sql_result", pollArgs(ctx, a, { statement_id: id })));
        if (!obj(a) || state(a) === "") throw fail(NOT_ROWS, m);
      }
      if (state(a) !== "SUCCEEDED") {
        var em = obj(a.status) && obj(a.status.error) ? str(a.status.error, "message") : "";
        throw fail(em.trim() || DBX_STATES[state(a)] || "The query didn’t finish.", m);
      }
      var man = obj(a.manifest) ? a.manifest : null, cols0 = man && obj(man.schema) && Array.isArray(man.schema.columns) ? man.schema.columns : null;
      if (!cols0) throw fail(NOT_ROWS, m);
      var cols = cols0.map(function (c) { return obj(c) ? { name: str(c, "name"), type: str(c, "type_name") } : { name: "", type: "" }; });
      var res = obj(a.result) ? a.result : {};
      var data = Array.isArray(res.data_array) && res.data_array.length ? res.data_array : Array.isArray(res.data_typed_array) ? res.data_typed_array : res.data_array || [];
      var cell = function (c) { if (!obj(c)) return c; if ("value" in c) return c.value; var k = Object.keys(c).filter(function (x) { return c[x] != null; }); return !k.length || k.indexOf("null_value") >= 0 ? null : k.length === 1 ? c[k[0]] : c; };
      var t = table(cols, function (r) { return Array.isArray(r) ? r.map(cell) : obj(r) && Array.isArray(r.values) ? r.values.map(cell) : null; }, data, function (type, v) {
        if (typeof v !== "string") return v;
        var u = type.toUpperCase();
        if (u === "BYTE" || u === "SHORT" || u === "INT" || u === "LONG" || u === "DECIMAL") return exact(v);
        if (u === "FLOAT" || u === "DOUBLE") return real(v);
        if (u === "BOOLEAN") return bool(v);
        return v;
      });
      if (!t) throw fail(NOT_ROWS, m);
      return { data: t.data, columns: t.columns, cut: man.truncated === true || Number(man.total_row_count) > t.data.length, meta: m };
    };
  }

  /** The `read` a loader gets: each reader bound to that load's call and args. */
  window.dashReads = function (ctx) {
    return Object.freeze({ bigquery: bigquery(ctx), governed: governed(ctx), snowflake: snowflake(ctx), databricks: databricks(ctx) });
  };
})();
