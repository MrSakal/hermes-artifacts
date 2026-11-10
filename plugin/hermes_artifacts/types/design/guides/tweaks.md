# Tweaks (`data-props`)

Each tweak: `{"editor": "text"|"color"|"int"|"float"|"range"|"boolean"|"enum"|null, "default": …}`; enum
`options` (values or `{"value", "label"}`); numbers/range `min` `max` `step` `unit`; `section` (group),
`label`; color `options` = 3–4 hex swatches. `editor: null` for callbacks/objects. `default` only seeds the
editor: fall back `this.props.x ?? …` in `renderVals()`. The user's values land in the `boards` entry's
`props` (theirs; keep them).

- **Tweaks = levers, not copy**: dark/density toggle, variant enum, item count, one accent/tint,
  spacing/type scale. None for copy (retyped in place) or a one-place color (panel).
- Style holes only for live state and declared tweaks (`{{accent}}`); other colors literal.
- **Multi-line prop text**: `
` + `white-space: pre-line`.
- Escaping inside the single-quoted attribute: `&amp;` for `&`, `&#39;` for `'`, `\"` for `"`.
