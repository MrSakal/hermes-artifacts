# Fonts beyond the default

`scenes.json` `fonts` slots `display` (headlines), `sans`, `serif`, `mono`; each = one of **the ten** by id,
or a Google Fonts family over the nearest of the ten: `{"family":"Inter","or":"instrument-sans"}` (400+700;
else `"weights":[400,800]`, ≤4). Name from memory; never download a font. Exposed as `--display`, `--sans`,
`--serif`, `--mono` on `#stage` and `kit.fonts`.

The ten: text `plus-jakarta-sans` (wide), `manrope` (round, to 800), `space-grotesk` (angular),
`instrument-sans` (narrow), `fraunces` (serif), `dm-mono`, `departure-mono` (pixel; VT323 stands in);
headlines `fraunces-display` (hairline italic: `font-style:italic; font-weight:200` on the headline class),
`inter-display` (loud, to 900), `shantell-sans` (hand-drawn).

- Two faces; a third only as `mono`.
- A named family goes in the slot meant; not on Google Fonts → nearest, and say "X isn't on Google Fonts,
  so I chose Y, the closest match there, and I'll use X if you send me its font files."
- Their font files: `assets/<Face>.woff2` (face = file stem), named in `base.css` before the stack:
  `#stage { font-family:"Face-400", var(--sans, system-ui, sans-serif) }`.
