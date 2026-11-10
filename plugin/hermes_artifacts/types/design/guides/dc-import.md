# Child components (`<dc-import>`)

`<dc-import name="Card" item="{{ it }}" hint-size="100%,120px"></dc-import>` mounts the sibling
`Card.dc.html` (an artboard too: list it in `boards`, `w`/`h` = its `$preview`).

- Other attributes → props (kebab → camel); object/callback props declared `"editor": null`; no prop
  named `name`.
- Fine in `<sc-for>`; never self-close it or write `<Card/>`.
- The child's `<helmet>`: only font `<link>`, `@font-face`, `body{margin:0}`; font-family and color on its
  root.
- Clicks inside a `<dc-import>` select the import itself.
