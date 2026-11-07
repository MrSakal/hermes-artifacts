# The look: colors, type and corners

A dashboard wears a look: `dashboard.json` `"look"`, values recorded once. The dashboard checks every value,
sets its own tokens from them for light and dark readers, and the page, written on the tokens
(`--color-*`, `--chart-1..8`, `dash.colors`, `--font-sans`, `--font-display`, `--radius`), wears it. So the
page names none of the look's colors, fonts or corners, and has no dark-mode rule.

**Design system first.** `artifact_guide` returns `design_system`. A default: read its tokens card
(`api/tokens.md`, else `tokens.json`) and record its look in the first build, without asking; one the user
names: the same. With none set and systems listed: name them and ask, when someone can answer; else the
dashboard's own look (no `look`). The look is a copy: a later edit of the system changes no dashboard until
you record it again: when the person asks, or when you change the dashboard anyway and `artifact_read`
reports `design_system_changed` (then say so in a line).

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

- `system`: the system's name, id and the version you read (from `design_system`). The Design panel shows
  the name to the people who edit the dashboard.
- Read the system by name and usage: the page background is `ground`, cards and surfaces `card`, body text
  `text`, secondary text `muted`, hairlines `border`. Fill both sets (its light and dark themes; one theme:
  derive the other). `charts` leads with the brand color, then the accents most unlike those chosen, in the
  same order in both sets (eight at most); statuses only where the system names them.
- Take only values from the system and write them only to `look`: no script, stylesheet, component, font
  file, image or wording of it goes into the page.
- A color is a hex or `rgb()`, `hsl()`, `oklch()`, `oklab()`, `lab()`, `lch()`: no names, `var()` or
  gradients. Lengths in `px` or `rem` within bounds: corners 0–32px, caption 9–18, body 11–22, heading
  12–32, title 16–64. A font stack is up to twelve names; no font files load, so end it in faces every
  reader has and a generic.
- A light `ground` is `#eaeaea` or lighter, a dark one `#383838` or darker; one just outside is moved
  toward white or black, one far outside drops its set. `text` needs 4.5:1 on ground and card, `muted`
  3:1 (else they are worked out), a chart color 1.5:1.
- A ready-made look, only when the person asks for one by name: Clay (warm paper, clay and ink), Ocean
  (cool blue-white, deep blues and teal), Meadow (soft green-white, greens and ochre). `artifact_guide
  type=dashboard topic=looks` gives each whole.
- Asked to drop the look, remove `look`.
