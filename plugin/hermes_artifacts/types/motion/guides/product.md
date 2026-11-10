# Product films

Their UI rebuilt from its real code: same nesting, classes, exact numbers; states are attributes toggled
from t, never `:hover`. Product UI only eases.

- **Marks:** `const marks = new kit.Marks(kit.svgLayer()); marks.add({id, kind, t0, dur, out, color, width, …}); marks.render(t)`;
  kinds `circle {x,y,w,h}`, `underline {x,y,w}`, `arrow {from, to}`, `bracket {x,y,h,side}`,
  `scribble {x,y,w,h}`, `burst {x,y,r}`, `check {x,y,size}`, `cross {x,y,size}`, `path {d:[[x,y],…]}`; `color` from the palette.
- **Geometry:** `kit.srect(node)` (stage px, camera incl.), `kit.camrect(node, cam)` (camera scene space),
  `kit.center(node, dx, dy)` → `() => [x,y]`, `kit.phraseRect(el, 'phrase')`, `kit.phraseCamRect(el, phrase, cam)`.
- **Cursor:** `const cur = kit.cursor()`: `cur.keys = [{t, at:[x,y] | () => [x,y], bow, lin}]`, `cur.clicks = [t…]`,
  `cur.holds = [[a,b]]`, `cur.ewSpans`, `cur.shapes = [{spans, gfx: kit.cursors.text}]`, `cur.visible = t => opacity`,
  `cur.scale`; `cur.render(t)`. ~30 px on screen; move `cur.el` into a camera layer to author in scene space.
- `kit.chip(text, {x, y, anchor:[ax, ay], style})` caption pill with leader; `kit.show(node, t, tIn, tOut)`;
  `kit.spotlight(rect, amount, {pad, radius})` dims `kit.fx` outside a rect (in `render`).
- `await kit.raster(htmlOrNode, {css, width, height, scale})` in `init` → canvas of the fragment, for heavy
  static screens you only pan; `kit.plateStats()`.
