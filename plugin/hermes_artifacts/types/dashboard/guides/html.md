# `index.html`: a part the layout can't express

Drawn below the layout, or alone without `layout`. Write it by `topic=editing` too (one writer per part).
Scripts get `dash` and `d3` v7:

- `dash.data(id)` → `{status, data, columns, meta, cut, message, refreshing}` (`rows` too);
- `dash.onData(fn)` redraws on every change; `dash.calc(id, {inputs, fn, title})` a computed source;
- `dash.params()`, `dash.setParams()`, `dash.colorValues()`, `dash.format()`;
- class `dash-select` styles a dropdown; the type stamps `data-dash-source-state="loading|refreshing|error|empty"`
  on marks and `data-dash-state="loading|error"` on `#dash-root`.

Mark shown values with `data-source` / `data-field` / `data-where`; tables take `data-row-key` plus
`data-key` per row. Theme variables only (`--color-*`, `--chart-1..8`, `--font-sans`, `--font-display`),
no fixed colors. No network, forms, frames or `on…=` attributes.
