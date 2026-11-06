kit.score(function (S, T) {
  // 120 bpm from 0.5 s: bar lines land on the cuts (beat 8 = the lamp, beat 16 = the walk), the end card on beat 18.
  S.tempo(120, { t0: 0.5 });
  S.program('pad', 'pad', { rev: 0.6, gain: -3 });
  S.program('glock', 'glock', { rev: 0.5, pan: 0.2, gain: -4 });
  S.program('mallet', 'marimba', { rev: 0.3, pan: -0.15 });
  S.program('bass', 'bass', { gain: -2 });
  // Open near silent: a pad and a chime as the title settles.
  S.chord('pad', ['D3', 'F#3', 'A3', 'C#4'], { t: 0, dur: 4.6, vel: 38 });
  S.fx('chime', 0.25, { vel: 52 });
  // The lamp: a glockenspiel figure turning like the lens, a whoosh each time the beam crosses us.
  S.chord('pad', ['B2', 'D3', 'F#3', 'A3'], { beat: 8, beats: 8, vel: 44 });
  S.pattern('glock', 'x.x.x...', { from: 8, repeat: 4, pitch: ['F#5', 'A5', 'D6', 'C#6', 'B5', 'A5'], vel: 50 });
  S.fx('whoosh', T.lamp + 0.55, { dur: 0.7, vel: 60 });
  S.fx('whoosh', T.lamp + 2.55, { dur: 0.7, vel: 55, pan: 0.3 });
  // The walk: the groove comes in with the boat, sparkles as the lanterns light, the hit on the end card.
  S.chord('pad', ['G2', 'B2', 'D3', 'F#3'], { beat: 16, beats: 4, vel: 50 });
  S.chord('pad', ['A2', 'C#3', 'E3', 'A3'], { beat: 20, beats: 2, vel: 50 });
  S.note('bass', 'G2', { beat: 16, beats: 3.5, vel: 70 });
  S.note('bass', 'A2', { beat: 20, beats: 1.8, vel: 70 });
  S.pattern('mallet', 'x.xx.x.x', { from: 16, repeat: 3, pitch: ['D5', 'A4', 'F#4', 'A4', 'B4', 'G4'], vel: 56 });
  S.drums({ kick: 'x...x...', shaker: 'oxoxoxox' }, { from: 16, repeat: 3, vel: 54 });
  S.fx('sparkle', T.walk + 0.2, { dur: 2.2, vel: 44 });
  S.drum('crash', { beat: 18, vel: 46 });
  S.fx('ding', T.walk + 1.0, { vel: 92 });
  // Drop back, then let the last chord ring.
  S.chord('pad', ['D3', 'A3', 'D4', 'F#4'], { beat: 22, beats: 4, vel: 56 });
  S.note('bass', 'D2', { beat: 22, beats: 4, vel: 74 });
  S.chord('glock', ['D6', 'A5'], { beat: 22, beats: 2, vel: 54 });
  S.master({ gain: -4, fadeOut: 1.4 });
});
