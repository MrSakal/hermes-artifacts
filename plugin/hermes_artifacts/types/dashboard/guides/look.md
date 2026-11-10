# The look: colors, type and corners

`dashboard.json` `"look"`: values recorded once. The dashboard checks every value and sets its own
tokens from them for light and dark; the page, written on the tokens (`--color-*`, `--chart-1..8`,
`dash.colors`, `--font-sans`, `--font-display`, `--radius`), wears it. The page names none of the look's
colors, fonts or corners and has no dark-mode rule. The look dresses the dashboard's own area only;
the bar, the Sources panel and menus around it keep Hermes' theme.

**Design system first.** `artifact_guide` returns `design_system` with its tokens card. A default, or
one the user names: record its look in the first build, without asking; read nothing else of it. None set but systems listed: name them and ask, when someone can answer; else the
dashboard's own look (no `look`). The look is a copy: a later edit of the system changes no dashboard
until you record it again, when the person asks, or when you change the dashboard anyway and
`artifact_read` reports `design_system_changed` (then say so in a line).

```json
"look": {
  "system": { "name": "Acme", "id": "<the design system's id>", "version": 7 },
  "light": { "ground": "#f3f5f9", "card": "#ffffff", "text": "#0d1b33", "muted": "#5a6780", "border": "#d6dce8",
             "good": "#1d7a4c", "warning": "#b06a00", "bad": "#c0392f", "charts": ["#1d3f77", "#ee6a57"] },
  "dark":  { "ground": "#0e1420", "...": "the same keys" },
  "corners": "4px",
  "sizes": { "caption": "12px", "body": "14px", "heading": "16px", "title": "26px" },
  "fonts": { "text": "'Instrument Sans', system-ui, sans-serif", "display": "Fraunces, Georgia, serif" }
}
```

- `system`: name, id and the version you read (from `design_system`).
- Map by name and usage: page background `ground`, cards/surfaces `card`, body text `text`, secondary
  text `muted`, hairlines `border`. Fill both sets (its light and dark themes; one theme: derive the
  other). `charts`: brand color first, then the accents most unlike those chosen, same order in both
  sets, eight at most. Statuses only where the system names them.
- Take only values from the system, written only to `look`: no script, stylesheet, component, font file,
  image or wording of it goes into the page.
- Color: hex or `rgb()`, `hsl()`, `oklch()`, `oklab()`, `lab()`, `lch()`; no names, `var()` or gradients.
  Lengths in `px` or `rem` within bounds: corners 0–32px, caption 9–18, body 11–22, heading 12–32,
  title 16–64. Font stack: up to twelve names; no font files load, so end it in faces every reader has
  and a generic.
- Light `ground` `#eaeaea` or lighter, dark `#383838` or darker; just outside is moved toward white or
  black, far outside drops its set. `text` needs 4.5:1 on ground and card, `muted` 3:1 (else worked
  out), a chart color 1.5:1.
- Ready-made looks, only when the person asks by name: Clay (warm paper, clay and ink), Ocean (cool
  blue-white, deep blues and teal), Meadow (soft green-white, greens and ochre). `artifact_guide
  type=dashboard topic=looks` gives each whole.
- Asked to drop the look: remove `look`.
