# The cover

`components/Cover/preview.html`, line 1 `<!-- @dsCard height=288 -->` (240–360); the folder stays bare (no
README). Shown above the brand book and as the thumbnail; laid out 960px wide, scaled to fit. Write it
LAST; like any preview it loads the system's tokens and fonts, with no network.

- 3–5 full-value colour blocks (¼–½ of the area, weighted by identity, arranged as the brand composes,
  never a row of equal squares).
- ONE pattern from the system's character (discs/pills for soft, dot grid for precise, a few hairlines for
  editorial, a literal motif from radii).
- The name in the display face ≤120px bottom-left; one tagline line at 13–14px in muted ink, ≤440px wide.
- Every fill, stroke and `rx` a token-bound class; blocks and pattern right of x = 480; no images,
  gradients, motion; check every theme.
- Keep a four-line derivation comment atop the SVG (blocks, arrangement, pattern and why, scales).
- Regenerate it only when the name, palette, display face or scales change.

`tokens.css` compiles to: `:root, [data-theme="<first>"]` with colours and shadows, a `[data-theme="<id>"]`
block per further theme, `:root` with spacing, radii, other families and `--font-<key>`, a `.<style>` class
per type style, `@font-face` per font.
