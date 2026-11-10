# Components: previews, bundle, libraries

| path | what | notes |
| --- | --- | --- |
| `components/<Comp>/README.md` | guidelines | first sentence = summary; `<Comp>` an ASCII identifier; say what the consumer provides (props, children, container, data) |
| `components/<Comp>/preview.html` | live preview | line 1 = marker (below) |
| `components/bundle.js` | ONE classic script | assigns `window.<namespace>`; no `import`, no network, no literal `</script` or `<!--` |
| `components/bundle.css`, `components/index.d.ts` | stylesheet, types as docs | `bundle.css` loads after the tokens |
| `components/lib/*.js` | libraries previews load | classic scripts, in `libraries` order, before bundle.js |

`design-system.json` `libraries`: what previews load, e.g. `[{"name": "react", "version": "18.3.1",
"global": "React", "file": "components/lib/react.production.min.js"}]`; none: `[]`. `namespace` = the
bundle's global (`window.Acme`).

## A preview

```html
<!-- @dsCard group="Actions" height=88 subtitle="primary · quiet" -->
<!doctype html>
<html><head><meta charset="utf-8"><title>Button</title></head>
<body><div id="root" class="row"></div>
<script>document.getElementById("root").append(Acme.Button({ label: "Save", variant: "primary" }));</script>
</body></html>
```

- Marker (line 1): `group` = Components page section, `height` = row px (40–4000, default 120, grows to
  fit), `width` = layout width scaled to fit, `subtitle` = line under the name, `floor` = card without live
  example, `page` = showcase page, not an export.
- The frame preloads `tokens.css`, `@font-face` rules, `bundle.css`, `components/lib` scripts, `bundle.js`,
  and sets `<html data-theme="<theme>">` (the theme switcher changes it). Render ONE component in a few
  states; no `<iframe>`, `<object>`, `<embed>`.
- Sandbox, **no network**: no CDNs, no Google Fonts. System files load by relative path
  (`../../assets/Logos/mark.svg`, `./demo.js`). React bundles need `react` + `react-dom` as files in
  `components/lib/` (in `libraries`), else previews stay blank (the page says so). Plain DOM needs nothing.
- Text 4.5:1 on its ground in every theme and preview.

`tokens.css` compiles to: `:root, [data-theme="<first>"]` with colours and shadows, a `[data-theme="<id>"]`
block per further theme, `:root` with spacing, radii, other families and `--font-<key>`, a `.<style>` class
per type style, `@font-face` per font.
