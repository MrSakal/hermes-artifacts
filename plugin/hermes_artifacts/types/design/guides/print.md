# Print and PDF pages

Decide first (unsure: documents flow, rest fixed, Letter/A4):

- **Fixed** (no `print`): artboard = one PDF page at frame size (posters, flyers, certificates, résumés,
  one-pagers). Letter 816×1056, A4 794×1123, Legal 816×1344, Tabloid 1056×1632, A5 559×794, A3 1123×1587
  (landscape: swap); a given poster size = inches × 96. ≥40 px clear inside edges (72 around running text).
  Multi-page: artboards in reading order on one page.
- **Flow** (`boards` entry `"print": "flow"`, `"paper": "letter"|"a4"`, `w` 816 or 794): one artboard, the
  export paginates. Root `width` = `w`, no fixed height, padding 72 px; paper color on `<body>`. Breaks
  fall between lines, never through `<img>`/`<svg>`; headings keep with the next block; nothing repeats per
  page; one text column.
- Type: body 16 px (12 pt), line-height 1.5–1.65, min 12 px; tables: header row, ≥1 px rules; no grey
  lighter than #767676; must read in grayscale. Flyer: ONE dominant line, the five Ws grouped tight.
