# Live answers that aren't plain rows

- **Answers** read as rows: row objects (bare or under `rows`/`data`/`results`), `{result: "<json>"}`,
  BigQuery's `{schema, rows}`. Anything else needs `rowsAt`/`fields`, or a loader.
- **Still running** (BigQuery `jobComplete: false`, Databricks `PENDING`/`RUNNING`, "still running"): the
  source re-asks at 2 s doubling to 20 s, up to 3 minutes, repeating the call or running the source's
  `"poll": {"tool": "…", "args": {"jobId": "{{answer.jobReference.jobId}}"}}` (args from the last answer).
- **Loader** (in `index.html`): `dash.loader(id, {description, fn})` turns a query's answer into the rows its
  page reads, as Claude's does. `fn({answer, call, args, read})`, may be async:
  - `answer`: the tool's answer as you saw it; `args`: call arguments with filters filled in;
  - `await call(tool, args)`: another tool of the same connector (a query left running, a further page;
    read-only, only once the dataset is allowed);
  - `read.bigquery(answer)` (waits on a running job via `get_query_results`), `read.governed(answer)`
    (`<query_result>` XML), `read.snowflake(answer)` (`result_set`), `read.databricks(answer)` (waits via
    `poll_sql_result`);
  - returns rows, `{columns, rows, cut}` or `{data, columns, meta}`; `meta` =
    `[{label, value, type: "text"|"code", lang?: "sql"}]`, shown under Result in Sources; `cut: true` =
    rows missing. `throw new Error(<the connector's words>)` fails the source.
  - Reshape only: filter/aggregate/compute in the query or a `dash.calc`. No call starts after fifteen
    minutes; an identical call starts at least a second after the last began.
