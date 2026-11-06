const { seg, eo, eio, lerp, TextFx } = kit;

kit.scene('lamp', {
  init(kit) {
    this.stars = W.stars(kit, 60, 23, 700);
    this.rip = W.ripples(kit, 30, 880, 9);
    // Gulls far off: a few strokes each, flapping slowly, each from its own seed.
    const r = kit.rng(4);
    this.gulls = Array.from({ length: 4 }, () => ({ x: 200 + r() * 600, y: 300 + r() * 260, sp: 40 + r() * 30, f: 3 + r() * 1.5, s: 0.6 + r() * 0.5 }));
    kit.stage.append(kit.h('<div class="ground"><div class="air"></div>' +
      '<svg class="art lamp-far" viewBox="0 0 1920 1080">' + this.stars.markup + W.moon('lamp-halo', 330, 210, 60) +
        W.sea('lamp-sea', 880) + this.rip.markup +
        '<path class="lamp-coast" d="M-40 884 Q200 860 420 872 T900 868 V900 H-40 Z" style="fill:color-mix(in srgb, var(--hill) 80%, var(--deep))"/>' +
        '<g class="lamp-gulls">' + this.gulls.map(() => '<path style="fill:none;stroke:color-mix(in srgb, var(--second) 75%, var(--sky));stroke-width:5;stroke-linecap:round;stroke-linejoin:round"/>').join('') + '</g></svg>' +
      '<svg class="art lamp-near" viewBox="0 0 1920 1080">' +
        '<g class="lamp-beamg">' + W.beam('lamp-beam') + '</g>' +
        '<defs><radialGradient id="lamp-flare"><stop offset="0" style="stop-color:var(--glow);stop-opacity:.9"/><stop offset=".35" style="stop-color:var(--glow);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--glow);stop-opacity:0"/></radialGradient></defs>' +
        '<g class="lamp-tower" transform="translate(1290 1320) scale(1.45)">' + W.lighthouse('lamp-light') + '</g>' +
        '<circle class="lamp-flarec" cx="1290" cy="464" r="260" fill="url(#lamp-flare)"/></svg>' +
      '<div class="calm"></div><div class="edge"></div>' +
      '<div class="words" style="left:120px;bottom:120px;width:860px"><h2 class="mid">Every night at nine</h2><p class="sub lamp-sub">The lamp has turned since 1898</p></div></div>'));
    const q = (s) => kit.stage.querySelector(s);
    this.stars.bind(q('.stars'));
    this.rip.bind(q('.ripples'));
    q('.lamp-gulls').querySelectorAll('path').forEach((p, i) => { this.gulls[i].el = p; });
    Object.assign(this, { far: q('.lamp-far'), near: q('.lamp-near'), beam: q('.lamp-beamg'), flare: q('.lamp-flarec'), lens: q('.lamp-light-lens'),
      line: q('.mid'), sub: q('.lamp-sub') });
  },
  render(t) {
    // A slow tilt up the tower: the near layer travels further than the sky.
    const tilt = eio(seg(t, 0, 4));
    this.far.style.transform = 'translateY(' + lerp(-10, 14, tilt).toFixed(1) + 'px) scale(1.02)';
    this.near.style.transform = 'translateY(' + lerp(-40, 30, tilt).toFixed(1) + 'px)';
    this.stars.render(t + 4.5);
    this.rip.render(t + 4.5);
    for (const g of this.gulls) {
      const x = g.x + g.sp * t, y = g.y - 6 * t, w = 14 * g.s * Math.sin(t * g.f), s = 22 * g.s;
      g.el.setAttribute('d', 'M' + (x - s) + ' ' + (y - w) + ' Q' + (x - s / 3) + ' ' + (y + 2) + ' ' + x + ' ' + y + ' Q' + (x + s / 3) + ' ' + (y + 2) + ' ' + (x + s) + ' ' + (y - w));
    }
    // The beam: the lamp turns once every four seconds; the wedge is its shadow on the picture.
    const turn = t * Math.PI * 2 / 4 + Math.PI * 0.85, c = Math.cos(turn), facing = Math.max(0, Math.sin(turn));
    this.beam.setAttribute('transform', 'translate(1290 464) scale(' + (c * 1.25).toFixed(3) + ' ' + (1 + 0.25 * facing).toFixed(3) + ')');
    this.beam.style.opacity = (0.55 + 0.45 * Math.abs(c)).toFixed(2);
    this.flare.style.opacity = (0.25 + 0.75 * Math.pow(facing, 3)).toFixed(3);
    this.flare.setAttribute('r', (200 + 160 * facing).toFixed(0));
    this.lens.setAttribute('transform', 'translate(' + ((t * 34) % 22).toFixed(1) + ' 0)');
    TextFx.fadeFromRight(this.line, t, 0.7);
    this.sub.style.opacity = eo(seg(t, 1.7, 2.2));
  },
});
