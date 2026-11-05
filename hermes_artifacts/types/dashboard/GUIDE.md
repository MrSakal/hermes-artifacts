# Dashboard artifacts

A dashboard is a page of numbers, charts and tables drawn from **datasets**. Every figure comes from a
dataset, so a reader can click it and see where it came from ("Where numbers come from").

## Files (publish them with `artifact_publish type=dashboard files={...}`)

- `dashboard.json`
  ```json
  {"title": "Signups", "params": {"region": ""},
   "datasets": {
     "daily": {"title": "Signups per day", "description": "Completed signups, UTC days.",
               "source": {"kind": "file", "path": "data/daily.csv"},
               "updated": {"at": "2026-11-05T08:00:00Z", "by": "hermes"},
               "schedule": "daily at 8:00", "staleAfterHours": 48},
     "plans": {"title": "Plans", "source": {"kind": "rows", "rows": [{"plan": "pro", "n": 12}]}, "fixed": true}}}
  ```
  `source.kind`: `call` (a live MCP query, below), `file` (a CSV, TSV or JSON file of the artifact;
  JSON is an array of row objects or `{"rows": [...]}`), or `rows` (rows inline). Ids: letters, digits,
  `_`, `-`.

## Live data: a stored MCP call (prefer this when the data came from a connector)

If you got the numbers from an MCP tool, the dashboard should get them the same way, so it stays
current. Store the call that worked in your session as the dataset's source, with its `args` unchanged:

```json
"sales": {"title": "Sales per month", "description": "Signed orders, net HUF.",
  "source": {"kind": "call", "tool": "mcp_mydb_query",
             "args": {"sql": "SELECT month, SUM(net) AS net FROM orders WHERE ('{{region}}' = '' OR region = '{{region}}') GROUP BY month ORDER BY month"},
             "rules": {"region": {"pattern": "^[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű .-]{0,40}$"}}},
  "maxAgeMinutes": 10}
```

- `tool` is the tool's name exactly as you called it (MCP tools only; built-in tools are refused).
  Make the call read-only. Let the connector aggregate and filter, and ask only for the columns the page uses.
- The dashboard runs the call when it opens, when the viewer presses Refresh (which skips the cache),
  and when a filter it names changes. Answers are cached on the server for `maxAgeMinutes` (default 10).
- The first time, the user sees the query and allows it with a click. A changed `tool`, `args` or
  `rules` needs a new approval.
- `{{name}}` is a filter from `dash.params()` (defaults from `params`). As a whole argument
  (`"limit": "{{n}}"`) it is the typed value. Inside text it is written in as-is, so put the language's
  quotes around it yourself and give every name a `rules` entry: `pattern`, `enum`, `type: "number"` with
  `minimum`/`maximum`, `type: "boolean"`, `minLength`/`maxLength`. Never let a pattern admit the quote you
  wrapped it in. A text value with no rule may only be plain text (no quotes, backslashes or new lines).
- Answers that are row objects (bare or under `rows`/`data`/`results`), or BigQuery's
  `{schema, rows: [{f: [{v}]}]}`, arrive as rows. Anything else comes as `dash.data(id).data`. Add a
  `dash.loader(id, {description, fn: ({answer}) => rows})` to reshape it into rows.
- Use a `file` source only when the data has no connector, or when the user asked for a fixed copy.
- `index.html`: the page. It is mounted into `<div id="dash-root">`; no `<html>`, `<head>` or `<body>`.
  Its `<script>`s run in order, each in its own scope, with `dash` and `d3` (v7) available.
  `<link rel="stylesheet" href="x.css">` and `<script src="x.js">` may name the artifact's own files.
- `data/*.csv|tsv|json`: the data files.

No network, forms, frames or `on…=` attributes (they are dropped). Show data values with
`textContent` or d3 `.text()`, never `innerHTML`.

## The `dash` API

- `dash.data(id)` → `{status, data, rows, columns, message, meta, value, refreshing}`; `status` is `ok`,
  `loading`, `connect` (waiting for the user to allow a live query), `declined`, `error` or `missing`.
  Draw a placeholder for every status but `ok`; a refresh keeps the last data, with `refreshing` true. CSV cells are text: convert them (`Number(r.value)`).
- `dash.onData(fn)`: runs `fn` now and on every change (filters, width). Redraw everything in it.
- `dash.calc(id, {inputs: [ids], fn: (a, b) => ..., title, description})`: a value worked out from
  datasets; readers see `fn`'s text. Read it with `dash.data(id)` (`.value` when it isn't rows).
- `dash.loader(id, {description, fn: ({answer, rows, columns, params}) => rows})`: reshape a file into
  rows (only reshaping; arithmetic goes in a calc).
- `dash.params()`, `dash.setParams({name: value})`, `dash.resetParams()`: filters. Defaults come from
  `dashboard.json` `params`; the viewer's choice is remembered.
- `dash.colors` (8 theme-aware series colors), `dash.format(n, intlOptions)`, `dash.setLink(id)`.

## Marking (what makes "Where numbers come from" work)

Put a placeholder `—` in the markup and fill it in `onData`. Mark the smallest element that shows a value:

- one value: `data-source="<id>" data-field="<column>"`, plus `data-where="col=value"` or `data-row="0"`;
- a computed value: `data-source="<calc id>" data-field="<key>"`;
- a chart: `data-source="<id> [<id>…]"` once, on its container;
- a table from rows: `<table data-source="<id>" data-row-key="<key column>">`, `data-field` on each
  `<th>`, and `data-key="<key value>"` on each body `<tr>`.

## Look

Use the theme variables, never fixed colors: `--color-fg`, `--color-fg-muted`, `--color-bg`,
`--color-panel`, `--color-border-line`, `--color-ok`, `--color-warn`, `--color-bad`, `--chart-1` to
`--chart-8`, `--chart-grid`, `--chart-axis`, `--chart-reference`. Sizes: `--size-caption|body|heading|title|display`,
`--gap-*`, `--pad-*`, `--radius`. Fonts: `--font-sans`, `--font-serif`, `--font-mono`.
Ready classes: `.card`, `.grid` (cards side by side), `.kpis`, `.big` (a headline number), `.muted`,
`.caption`, `.up`/`.down`, `.dash-skeleton` (a loading bar), `.dash-tooltip`.

A dashboard serves one decision. Give it a one-line title and one sentence of takeaway filled from the
data. Put the figure nearest the outcome first, then charts in cards that state their time window.
Size charts from `clientWidth` as `<svg width="100%" viewBox>`. Use bars for counts per period and
lines for rates.

## Changing it

Republish with the same `id` and `base=true`, passing only the files that change. To refresh data,
write the new file and update the dataset's `updated`. Readers can download every dataset as CSV,
and the page as an HTML snapshot or as JSON.
