# Canvas extras: notes, pages, layout guides, diagrams

## Notes (`canvas.json` `notes`)

`{"<id>": {"x": 0, "y": -300, "text": "Flows", "kind": "title1", "maxW": 1840}}`; ids
`[A-Za-z0-9_-]{1,40}`; `x y text` required.

- `title1`: a title over SEVERAL artboards, never one (the strip names it). One bold 72 px line; `maxW` =
  row width (`maxH` if tight), longer text shrinks. ≥223 px above its row.
- no `kind`: a sticky; set `w`; grows to 4/3 `w` tall, then scrolls.
- Both: `size` (px or `s`|`m`|`l`|`xl`|`xxl`), `bold`, `italic`, `page`, `color`; sticky `fill`
  `gray`|`red`|`orange`|`green`|`teal`|`blue`|`purple`|`pink`.
- `link`: a card; `url` (http/https) required, `text` = title (else host), `w`.
- `rect` `oval` `pen` `line` `arrow` `image`: the user's; leave them.

## Pages

`pages`: `[{"id", "name"}]` (≤40; ids `[A-Za-z0-9_-]{1,40}`); a board or note's `page` = its id (none =
first page); `launch` `{"view": "canvas", "page": "<id>"}` opens on one.

## Layout guides (in a `boards` entry; canvas only)

≤6, only when genuinely useful: `{"kind": "columns", "count": 12, "gutter": 24, "margin": 80}` (`align`
`"stretch"` default; `"start"|"center"|"end"` pack `count` tracks of `"size"` px, `"offset"` from that
edge; `"count": "auto"`); `{"kind": "rows", …}`; `{"kind": "grid", "size": 8}`; optional `"color"`,
`"hidden": true`. Lay content on it: `display: grid; grid-template-columns: repeat(count, minmax(0, 1fr));
column-gap: <gutter>px; padding-inline: <margin>px`.

## Diagrams (flowcharts, org charts, system maps, timelines)

Placed elements, never one `<svg>`. Host `<div style="position: relative; width; height">`; cards =
`<div>` inline `position: absolute; left; top; width; height; box-sizing: border-box`, label as text; each
straight arrow segment its own small `<svg>` (8 px thick, marker head, unique id); file order = paint
order (bands, arrows, cards, labels). Cards on a grid, gaps ≥48 px, arrows from edge middles. Literal
markup (no `<sc-for>`, no holes in positions).
