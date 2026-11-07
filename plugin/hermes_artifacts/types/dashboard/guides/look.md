# The look: colors, type and corners

A dashboard can wear a look: `dashboard.json` `"look"`. The person picks one in the Design panel (the
Default look, Clay, Ocean, Meadow, or their default design system), or asks you. The dashboard checks
every value, sets its own tokens from them for light and dark readers, and the page, written on the
tokens (`--color-*`, `--chart-1..8`, `dash.colors`, `--font-sans`, `--font-display`, `--radius`), wears
it. So the page names none of the look's colors, fonts or corners, and has no dark-mode rule.

```json
"look": {
  "system": { "name": "Acme" },
  "light": { "ground": "#f3f5f9", "card": "#ffffff", "text": "#0d1b33", "muted": "#5a6780", "border": "#d6dce8",
             "good": "#1d7a4c", "warning": "#b06a00", "bad": "#c0392f", "charts": ["#1d3f77", "#ee6a57"] },
  "dark":  { "ground": "#0e1420", "...": "the same keys" },
  "corners": "4px",
  "sizes": { "caption": "12px", "body": "14px", "heading": "16px", "title": "26px" },
  "fonts": { "text": "'Instrument Sans', system-ui, sans-serif", "display": "Fraunces, Georgia, serif" }
}
```

- `ground` is the page background, `card` cards and popovers, `text`, `muted` (secondary text),
  `border` (hairlines); `good`, `warning`, `bad` the status colors; `charts` fills `dash.colors` from
  the first slot (eight at most), led by the brand color.
- A color is a hex or `rgb()`, `hsl()`, `oklch()`, `oklab()`, `lab()`, `lch()`: no names, `var()` or
  gradients. Lengths in `px` or `rem` within bounds: corners 0–32px, caption 9–18, body 11–22, heading
  12–32, title 16–64. A font stack is up to twelve names; no font files load, so end it in faces every
  reader has and a generic.
- A light `ground` is `#eaeaea` or lighter, a dark one `#383838` or darker; one just outside is moved
  toward white or black, one far outside drops its set. `text` needs 4.5:1 on ground and card, `muted`
  3:1 (else they are worked out), a chart color 1.5:1.
- Ready-made: Clay (warm paper, clay and ink), Ocean (cool blue-white, deep blues and teal), Meadow (soft
  green-white, greens and ochre). Picked from the Design panel they are written whole.
- From a design system: read its tokens (`artifact_read` of the design system), take only values and
  what each is for, fill both sets (its light and dark themes, or derive one), and write `look` once.
  Nothing else of the system goes into the dashboard.
- Asked to drop the look, remove `look`.
