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
  `source.kind`: `file` (a CSV, TSV or JSON file of the artifact; JSON = an array of row objects or
  `{"rows": [...]}`) or `rows` (rows inline). Ids: letters, digits, `_`, `-`.
- `index.html`: the page. It is mounted into `<div id="dash-root">`; no `<html>`, `<head>` or `<body>`.
  Its `<script>`s run in order, each in its own scope, with `dash` and `d3` (v7) available.
  `<link rel="stylesheet" href="x.css">` and `<script src="x.js">` may name the artifact's own files.
- `data/*.csv|tsv|json`: the data files.

No network, forms, frames or `on…=` attributes (they are dropped). Show data values with
`textContent` or d3 `.text()`, never `innerHTML`.

## The `dash` API

- `dash.data(id)` → `{status, data, rows, columns, message, meta, value}`; `status` is `ok`, `error` or
  `missing`. CSV cells are text: convert them (`Number(r.value)`).
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
