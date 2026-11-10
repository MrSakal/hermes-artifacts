# A film with no list of scenes

Without `modules/script.js` the script is implicit: `window.CUT = kit.scenes();`. A `modules/script.js` may
define the whole film instead (no `scenes.json` needed):

```js
window.CUT = {
  width: 1920, height: 1080, fps: 30, duration: 32.4, background: '#f4f2ee',
  chapters: [{ t: 0, label: 'Title' }, { t: 2.6, label: 'The app' }],
  async init(kit) { /* build kit.stage once */ },
  render(t, kit) { /* SYNCHRONOUS */ },
  score(S, kit) { /* optional */ },
};
```

`render(t, kit)` follows the same rules as a scene's: pure, every varying property from `t` alone.
