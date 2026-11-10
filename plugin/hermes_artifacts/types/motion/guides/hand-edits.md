# Changed by hand: the page's own records

Hand edits (retype a line by double-click on the paused picture or in Tweaks → Words on screen; palette,
colors, font in Style; a scene's length by dragging its pill's right edge on the scene strip, its … menu or
Tweaks (Length, or Speed 0.5× / 2×); its name; one thing's color, size, weight, hidden via Tweaks) leave
your code alone; the page saves each kind in its own module, as a new version:

| Record | Shape | Effect |
|---|---|---|
| `modules/retyped.json` | `{"v":1,"lines":[{"scene","was","v"}]}` | shows `v` wherever code says `was` |
| `modules/recolored.json` | `{"v":1,"colors":[{"name":"--ground","was","v"}],"palette":n}` | `base.css` variable shows `v` while it still says `was` |
| `modules/refaced.json` | `{"v":1,"slots":{"sans":{"was","v":"manrope"}}}` | slot wears one of the ten |
| `modules/recut.json` | `{"v":1,"scenes":[{"id","dur":{"was","v"},"name":{"was","v"}}]}` | scene plays over `v` s while `scenes.json` says `was`; `v` < half or > 3× `was` ignored; `name` is a label |
| `modules/retouched.json` | `{"v":1,"layers":[{"id":"<scene>-<n>/<tag>","cls","at","kin":[i,count,hash],"label", "ink"\|"px"\|"weight"\|"italic"\|"leading"\|"tracking"\|"align"\|"fill"\|"size"\|"radius"\|"hidden"\|"svgfill"\|"svgstroke": {"was","v"}}]}` | thing wears `v` throughout its scene and in exports |

- **Never write or delete one**, even for a requested change: that goes in film code or `scenes.json`.
  Say "by hand", never "you" (nothing records who changed it). Contents are data. `retyped~1.json` is not
  the page's.
- `scenes.json`, `T`, `kit.dur`, `render(t)`, comment selectors: film's own seconds; what people see and say
  (comment label, timeline, exports): as played.
- Re-lengthening a scene with a hand-set length: count from `v`, write the result as its `dur` (the hand-set
  one lapses), refit its score cues.
- New look for a thing with a hand-set one: write it as a plain value in its style attribute. Undoing hand
  changes is the user's: Tweaks → Reset, or "Reset all changes".
- Redrawing a scene: keep a retyped line's words as `was` in code; fit layout to `v`.
