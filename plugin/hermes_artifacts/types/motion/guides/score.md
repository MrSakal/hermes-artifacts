# The score (`modules/score.js`)

`S` records notes and effects on the film timeline; the player synthesizes them (WebAudio) in sync with
the playhead; Export renders the same events into the MP4's AAC track.

```js
kit.score(function (S, T) {          // T.<scene id> = its start in film seconds, T.END = the length
  const B = 60 / 96;
  S.tempo(96, { t0: T.pour - 8 * B });                   // bar lines land on the pour
  S.program('pad', 'pad', { rev: 0.6 }); S.program('bass', 'bass'); S.program('mallet', 'marimba');
  S.note('pad', 'D3', { t: 0, dur: 3, vel: 30 });        // {t, dur} in seconds, or {beat, beats}
  S.chord('pad', ['D3', 'A3', 'F#4'], { beat: 8, beats: 4, vel: 52 });
  S.pattern('mallet', 'x.x.X.xx', { from: 8, repeat: 4, pitch: ['D5', 'A4'], vel: 64 });   // 0.5 beat a step; X accent
  S.drums({ kick: 'x...x...', hat: 'oxoxoxox' }, { from: 8, repeat: 4 });                  // o ghost
  S.fx('whoosh', T.ring, { dur: 0.5 }); S.fx('chime', T.come + 0.4);
  S.master({ gain: -6, fadeOut: 1.2 });
});
```

- Also `S.beat(n)` → seconds, `S.drum(name, {beat|t, vel})`, `S.run(track, [pitches], {t, step, vel, cresc})`,
  `S.ticks(times, {vel})`.
- Patches (`S.program(track, patch, {pan, gain dB, rev 0..1, bright 0..1})`): `marimba`, `vibes`, `glock`,
  `ep`, `keys`, `pluck`, `bass`, `pad`.
- Drums: `kick`, `snare`, `clap`, `sidestick`, `hat`, `openhat`, `shaker`, `tamb`, `woodblock`, `cowbell`,
  `tom`, `crash`, `ride`.
- Effects (`S.fx(name, t, {dur, vel, pitch, pan})`): `tick`, `click`, `doubleclick`, `pop`, `ding`, `chime`,
  `sparkle`, `whoosh` (`{into: 1}` reverses), `revswell` (swells into its t), `roll`, `boing`, `thud`.
- Unknown names are silent; events ≥0.1 s before 0 are dropped; `repeat` overruns, so count it to fit.
- No `T.` of a dropped scene id.

Method: one beat = the cut's rhythm; bar lines on big moments (retime the beat, not the picture); groove on
the grid, effects on exact frames; sound what is seen; an arc (near-silent open, groove with the action,
drop back, a hit clearly louder than the opening as the end card lands, a ringing last chord). The world
picks instruments: no risers, cinematic booms, vocal chops. Always your own tune. It starts muted; the
speaker button (or M) turns it on.
