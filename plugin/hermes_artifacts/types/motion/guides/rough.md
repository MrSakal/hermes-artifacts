# A rough cut: Continue and Finalize

A film with `"stage":"rough"` shows a Rough cut badge and two buttons that send these messages (scene
positions from 1):

- **"Continue the animation. Scenes left: 2, 5."**: write or mend those scenes. A scene whose module fails:
  find the bug and fix it; read `shared.js` too (a fault there fails every scene).
- **"Finalize the animation."**: redraw each rough scene finished (same ids, names, order, seconds, words),
  then the score (`topic=score`) and `"stage":"final"`.

**A rough scene** (only in a film already rough) sets `rough: true` in its `kit.scene('<id>', {…})` definition: a wireframe
with real words, places, sizes, timing; outlines (`.box` with `data-label="LADLE"`), no fill, texture,
camera or sound. The page shows it black-and-white with a hand-drawn boil.
