const { seg, eo, eob, eio, lerp, TextFx } = kit;
Object.assign(W, {
  // A paper lantern hanging from (0,0). Its glow and its lit paper are their own parts, so a scene lights it.
  lantern(cls, glowId) {
    return '<g class="' + cls + '"><path d="M0 0 V22" style="stroke:var(--hull);stroke-width:3"/>' +
      '<circle class="' + cls + '-glow" cx="0" cy="52" r="70" fill="url(#' + glowId + ')"/>' +
      '<rect x="-10" y="20" width="20" height="8" rx="2" style="fill:var(--hull)"/>' +
      '<ellipse cx="0" cy="52" rx="20" ry="25" style="fill:color-mix(in srgb, var(--accent) 30%, var(--hull))"/>' +
      '<ellipse class="' + cls + '-lit" cx="0" cy="52" rx="20" ry="25" style="fill:var(--glow)"/>' +
      '<path d="M-19 44 Q0 48 19 44 M-19 60 Q0 64 19 60 M0 27 V77" style="fill:none;stroke:color-mix(in srgb, var(--accent) 50%, var(--hull));stroke-width:2"/>' +
      '<rect x="-10" y="76" width="20" height="7" rx="2" style="fill:var(--hull)"/></g>';
  },
});

kit.scene('walk', {
  init(kit) {
    this.stars = W.stars(kit, 60, 31, 420);
    this.rip = W.ripples(kit, 40, 610, 17);
    // The pier runs to a vanishing point; each post and lantern is placed by its depth.
    const VX = 1180, VY = 600, P = (X, Y, z) => { const s = 1 / (1 + z * 0.55); return [VX + (X - VX) * s, VY + (Y - VY) * s, s]; };
    let posts = '', strings = '', lamps = '';
    this.lamps = [];
    const tops = [];
    for (let z = 0; z <= 7; z++) {
      const b = P(1840, 1080, z), tp = P(1840, 640, z);
      tops.push(tp);
      posts += '<path d="M' + (b[0] - 18 * b[2]).toFixed(1) + ' ' + b[1].toFixed(1) + ' V' + tp[1].toFixed(1) + ' h' + (36 * b[2]).toFixed(1) + ' V' + b[1].toFixed(1) + ' Z" style="fill:var(--hull)"/>';
    }
    for (let z = 0; z < 7; z++) {
      const a = tops[z], b = tops[z + 1], sag = 70 * a[2];
      strings += '<path d="M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + ' Q' + ((a[0] + b[0]) / 2).toFixed(1) + ' ' + ((a[1] + b[1]) / 2 + sag * 2).toFixed(1) + ' ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) + '" style="fill:none;stroke:color-mix(in srgb, var(--second) 30%, var(--hull));stroke-width:' + (3 * a[2] + 1).toFixed(1) + '"/>';
      for (const u of [0.3, 0.7]) {
        const x = lerp(a[0], b[0], u), y = lerp(a[1], b[1], u) + sag * 4 * u * (1 - u), s = lerp(a[2], b[2], u);
        this.lamps.push({ x: x, y: y, s: s, at: 0.2 + this.lamps.length * 0.32, ph: this.lamps.length * 1.7 });
        lamps += '<g class="walk-hang" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + s.toFixed(3) + ')">' + W.lantern('walk-lantern', 'walk-glowg') + '</g>';
      }
    }
    const deck = P(1840, 1080, 9), deckL = P(1000, 1080, 9);
    // Planks across the deck, closer together as they recede; a warm pool under the near lanterns.
    let planks = '';
    for (let z = 0.25; z < 9; z += 0.35) {
      const a = P(1000, 1080, z), b = P(1960, 1080, z);
      planks += 'M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + ' L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) + ' ';
    }
    const pool = P(1700, 1080, 0.6);
    posts = '<path d="' + planks + '" style="fill:none;stroke:color-mix(in srgb, var(--deep) 45%, var(--wood));stroke-width:3"/>' +
      '<ellipse class="walk-pool" cx="' + pool[0].toFixed(0) + '" cy="' + pool[1].toFixed(0) + '" rx="260" ry="70" style="fill:color-mix(in srgb, var(--glow) 14%, transparent)"/>' + posts;
    kit.stage.append(kit.h('<div class="ground"><div class="air"></div>' +
      '<svg class="art walk-far" viewBox="0 0 1920 1080">' + this.stars.markup + W.moon('walk-halo', 1500, 150, 40) +
        '<path d="M-40 618 Q240 560 520 590 T1000 600 V630 H-40 Z" style="fill:color-mix(in srgb, var(--hill) 80%, var(--deep))"/>' +
        '<g transform="translate(240 612) scale(.2)">' + W.lighthouse('walk-light') + '</g></svg>' +
      '<svg class="art walk-mid" viewBox="0 0 1920 1080">' + W.sea('walk-sea', 610) + this.rip.markup +
        '<g class="walk-boat" transform="translate(-300 850)">' + W.boat('walk-boat1', true) + '</g>' +
        '<path class="walk-deck" d="M1000 1080 L' + deckL[0].toFixed(1) + ' ' + deckL[1].toFixed(1) + ' L' + deck[0].toFixed(1) + ' ' + deck[1].toFixed(1) + ' L1960 1080 Z" style="fill:var(--wood)"/>' +
        '<path d="M1000 1080 L' + deckL[0].toFixed(1) + ' ' + deckL[1].toFixed(1) + '" style="stroke:color-mix(in srgb, var(--second) 40%, var(--wood));stroke-width:8"/>' +
        posts + strings +
        '<defs><radialGradient id="walk-glowg"><stop offset="0" style="stop-color:var(--glow);stop-opacity:.75"/><stop offset="1" style="stop-color:var(--glow);stop-opacity:0"/></radialGradient></defs>' +
        lamps + '</svg>' +
      '<div class="edge"></div>' +
      '<div class="words" style="left:120px;top:110px;width:980px"><h2 class="line">Harbor Lights</h2><p class="sub walk-sub">Saturday · 7 pm · Pier 3</p><p class="tag walk-tag">Free entry · bring a lantern</p></div></div>'));
    const q = (s) => kit.stage.querySelector(s);
    this.stars.bind(q('.stars'));
    this.rip.bind(q('.ripples'));
    kit.stage.querySelectorAll('.walk-hang').forEach((g, i) => {
      const L = this.lamps[i];
      L.g = g; L.glow = g.querySelector('.walk-lantern-glow'); L.lit = g.querySelector('.walk-lantern-lit');
    });
    Object.assign(this, { far: q('.walk-far'), mid: q('.walk-mid'), boat: q('.walk-boat'), pool: q('.walk-pool'), line: q('.line'), sub: q('.walk-sub'), tag: q('.walk-tag') });
  },
  render(t) {
    const push = eio(seg(t, 0, 5));
    this.far.style.transform = 'scale(' + lerp(1.0, 1.02, push) + ')';
    this.mid.style.transform = 'translate(' + lerp(0, -30, push).toFixed(1) + 'px,0) scale(' + lerp(1.0, 1.05, push) + ')';
    this.stars.render(t + 8.5);
    this.rip.render(t + 8.5);
    // The boat comes in on the left and settles, rocking a little after it stops.
    const arrive = eo(seg(t, 0, 3.2)), x = lerp(-320, 560, arrive), rock = 2.6 * Math.sin(t * 1.6) * (0.4 + 0.6 * (1 - arrive));
    this.boat.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + (850 + 4 * Math.sin(t * 1.1)).toFixed(1) + ') rotate(' + rock.toFixed(2) + ')');
    // Lanterns light from near to far, one about every third of a second, and sway in the breeze.
    for (const L of this.lamps) {
      const on = eob(seg(t, L.at, L.at + 0.45), 1.6), sway = 3.5 * Math.sin(t * 1.3 + L.ph);
      L.g.setAttribute('transform', 'translate(' + L.x.toFixed(1) + ' ' + L.y.toFixed(1) + ') scale(' + L.s.toFixed(3) + ') rotate(' + sway.toFixed(2) + ')');
      L.lit.style.opacity = Math.min(1, on).toFixed(3);
      L.glow.style.opacity = (Math.min(1, on) * (0.85 + 0.15 * Math.sin(t * 2.1 + L.ph))).toFixed(3);
    }
    this.pool.style.opacity = eo(seg(t, 0.3, 1.4)).toFixed(3);
    TextFx.fadeFromRight(this.line, t, 1.0);
    this.sub.style.opacity = eo(seg(t, 1.6, 2.1));
    this.tag.style.opacity = eo(seg(t, 2.1, 2.6));
  },
});
