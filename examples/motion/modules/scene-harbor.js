const { seg, eo, eio, lerp, TextFx } = kit;
Object.assign(W, {
  // A small fishing boat. Its waterline centre is (0,0), so a scene rocks it by turning one group.
  boat(cls, lit) {
    return '<g class="' + cls + '">' +
      '<path d="M-168 -14 Q-150 34 -104 42 H112 Q156 34 178 -22 Z" style="fill:var(--hull)"/>' +
      '<path d="M-168 -14 H178 L172 -4 H-164 Z" style="fill:color-mix(in srgb, var(--second) 70%, var(--hull))"/>' +
      '<path d="M-150 10 Q-130 34 -104 38 H112 Q140 32 160 8 Z" style="fill:color-mix(in srgb, var(--deep) 45%, transparent)"/>' +
      '<rect x="-70" y="-86" width="96" height="72" rx="6" style="fill:color-mix(in srgb, var(--second) 82%, var(--stone))"/>' +
      '<path d="M-78 -86 H34 L26 -100 H-70 Z" style="fill:var(--main)"/>' +
      '<rect x="-56" y="-72" width="28" height="24" rx="3" style="fill:' + (lit ? 'var(--glow)' : 'var(--sea)') + '"/><rect x="-18" y="-72" width="28" height="24" rx="3" style="fill:' + (lit ? 'var(--glow)' : 'var(--sea)') + '"/>' +
      '<rect x="-2" y="-86" width="28" height="72" style="fill:color-mix(in srgb, var(--deep) 25%, transparent)"/>' +
      '<path d="M70 -14 V-196 M70 -180 L150 -14 M70 -150 L-140 -14" style="fill:none;stroke:color-mix(in srgb, var(--second) 55%, var(--hull));stroke-width:4;stroke-linecap:round"/>' +
      '<circle cx="70" cy="-200" r="7" style="fill:var(--glow)"/>' +
      '<path d="M104 -14 v-26 h36 v26" style="fill:none;stroke:var(--wood);stroke-width:6"/></g>';
  },
  // The lighthouse, base centre at (0,0), 720 tall. Its lens bars sit in their own group so a scene can turn them.
  lighthouse(cls) {
    const half = (y) => 70 - 24 * (-y / 520), band = (a, b) => 'M' + -half(a) + ' ' + a + ' L' + -half(b) + ' ' + b + ' H' + half(b) + ' L' + half(a) + ' ' + a + ' Z';
    let bars = '';
    for (let x = -100; x <= 100; x += 22) bars += '<rect x="' + x + '" y="-636" width="9" height="92" style="fill:color-mix(in srgb, var(--accent) 40%, var(--second))"/>';
    return '<g class="' + cls + '"><defs><clipPath id="' + cls + '-glass"><rect x="-40" y="-636" width="80" height="92"/></clipPath></defs>' +
      '<path d="' + band(0, -520) + '" style="fill:var(--second)"/>' +
      '<path d="' + band(-110, -190) + ' ' + band(-270, -350) + ' ' + band(-430, -500) + '" style="fill:var(--main)"/>' +
      '<path d="M0 0 L0 -520 L46 -520 L70 0 Z" style="fill:color-mix(in srgb, var(--deep) 32%, transparent)"/>' +
      '<path d="M-16 0 V-56 Q0 -72 16 -56 V0 Z" style="fill:var(--hull)"/><rect x="-10" y="-260" width="20" height="30" rx="8" style="fill:var(--glow)"/>' +
      '<rect x="-86" y="-544" width="172" height="24" rx="5" style="fill:var(--stone)"/>' +
      '<path d="M-80 -544 V-578 H80 V-544 M-48 -544 V-578 M-16 -544 V-578 M16 -544 V-578 M48 -544 V-578" style="fill:none;stroke:var(--stone);stroke-width:5"/>' +
      '<rect x="-44" y="-640" width="88" height="100" rx="4" style="fill:var(--glow)"/>' +
      '<g clip-path="url(#' + cls + '-glass)"><g class="' + cls + '-lens">' + bars + '</g></g>' +
      '<path d="M-44 -640 V-544 M44 -640 V-544 M0 -640 V-544" style="fill:none;stroke:var(--hull);stroke-width:5"/>' +
      '<path d="M-58 -638 Q0 -712 58 -638 Z" style="fill:var(--main)"/><path d="M0 -700 V-736" style="stroke:var(--main);stroke-width:6"/><circle cx="0" cy="-740" r="7" style="fill:var(--main)"/></g>';
  },
  // A beam from the lamp: a soft wedge that a scene squeezes by the cosine of the lamp's turn.
  beam(id) {
    return '<defs><linearGradient id="' + id + '"><stop offset="0" style="stop-color:var(--glow);stop-opacity:.75"/><stop offset="1" style="stop-color:var(--glow);stop-opacity:0"/></linearGradient></defs>' +
      '<path d="M0 -18 L1500 -170 L1500 170 L0 18 Z" fill="url(#' + id + ')"/>';
  },
});

kit.scene('harbor', {
  init(kit) {
    this.stars = W.stars(kit, 70, 11, 430);
    this.town = W.town(kit, 5, 600);
    this.rip = W.ripples(kit, 46, 600, 3);
    kit.stage.append(kit.h('<div class="ground"><div class="air"></div>' +
      '<svg class="art harbor-far" viewBox="0 0 1920 1080">' + this.stars.markup + W.moon('harbor-halo', 1490, 170, 44) +
        '<path class="harbor-head" d="M1380 610 Q1500 520 1640 540 Q1780 548 1960 600 V640 H1380 Z" style="fill:color-mix(in srgb, var(--hill) 85%, var(--deep))"/>' +
        '<g class="harbor-beamg" transform="translate(1640 296) scale(.42)">' + W.beam('harbor-beam') + '</g>' +
        '<g transform="translate(1640 548) scale(.42)">' + W.lighthouse('harbor-light') + '</g>' + this.town.markup + '</svg>' +
      '<svg class="art harbor-mid" viewBox="0 0 1920 1080">' + W.sea('harbor-sea', 600) +
        '<path class="harbor-glints" d="M1640 640 v300 M300 640 v120 M520 630 v90" style="stroke:color-mix(in srgb, var(--glow) 35%, transparent);stroke-width:10;stroke-dasharray:14 22;stroke-linecap:round"/>' +
        this.rip.markup +
        '<g class="harbor-b2" transform="translate(1210 700) scale(.62)">' + W.boat('harbor-boat2', false) + '</g>' +
        '<g class="harbor-b1" transform="translate(760 820)">' + W.boat('harbor-boat1', true) + '</g></svg>' +
      '<svg class="art harbor-near" viewBox="0 0 1920 1080">' + W.quay('harbor-stones', 930, 1280, 2000) +
        '<path class="harbor-rope" style="fill:none;stroke:var(--wood);stroke-width:7"/>' +
        '<g class="harbor-post"><rect x="1420" y="862" width="56" height="74" rx="10" style="fill:var(--hull)"/><rect x="1410" y="852" width="76" height="22" rx="8" style="fill:color-mix(in srgb, var(--second) 30%, var(--hull))"/></g></svg>' +
      '<div class="edge"></div>' +
      '<div class="words" style="left:120px;top:110px;width:1000px"><p class="tag harbor-tag">Saturday on the old pier</p><h1 class="line">Harbor Lights</h1><p class="sub harbor-sub">A lantern walk at blue hour</p></div></div>'));
    const q = (s) => kit.stage.querySelector(s);
    this.stars.bind(q('.stars'));
    this.town.bind(q('.houses'));
    this.rip.bind(q('.ripples'));
    Object.assign(this, { far: q('.harbor-far'), mid: q('.harbor-mid'), near: q('.harbor-near'), b1: q('.harbor-b1'), b2: q('.harbor-b2'),
      rope: q('.harbor-rope'), beam: q('.harbor-beamg'), lens: q('.harbor-light-lens'), line: q('.line'), tag: q('.harbor-tag'), sub: q('.harbor-sub'), glints: q('.harbor-glints') });
  },
  render(t) {
    const push = eio(seg(t, 0, 4.5));   // one slow push; each layer travels its own distance
    this.far.style.transform = 'scale(' + lerp(1.0, 1.025, push) + ')';
    this.mid.style.transform = 'scale(' + lerp(1.0, 1.05, push) + ')';
    this.near.style.transform = 'translateX(' + lerp(0, -40, push) + 'px) scale(' + lerp(1.02, 1.1, push) + ')';
    this.stars.render(t);
    this.town.render(t, -0.4);
    this.rip.render(t);
    const r1 = 2.2 * Math.sin(t * 1.25), y1 = 5 * Math.sin(t * 1.05 + 0.6), r2 = 2.8 * Math.sin(t * 1.4 + 1.3);
    this.b1.setAttribute('transform', 'translate(760 ' + (820 + y1).toFixed(1) + ') rotate(' + r1.toFixed(2) + ')');
    this.b2.setAttribute('transform', 'translate(1210 ' + (700 + 3 * Math.sin(t * 1.2)).toFixed(1) + ') scale(.62) rotate(' + r2.toFixed(2) + ')');
    // The mooring rope from the stern to the post, sagging as the boat rocks.
    const sx = 760 + 160, sy = 820 + y1 - 20 + r1 * 3;
    this.rope.setAttribute('d', 'M' + sx + ' ' + sy.toFixed(1) + ' Q' + 1180 + ' ' + (930 + y1 * 2).toFixed(1) + ' 1430 868');
    const turn = t * Math.PI * 2 / 4 + 0.6;
    this.beam.setAttribute('transform', 'translate(1640 296) scale(' + (0.42 * Math.cos(turn)).toFixed(3) + ' .42)');
    this.lens.setAttribute('transform', 'translate(' + ((t * 30) % 22).toFixed(1) + ' 0)');
    this.glints.style.strokeDashoffset = (-t * 18).toFixed(1);
    this.tag.style.opacity = eo(seg(t, -0.8, -0.2));
    TextFx.fadeFromRight(this.line, t, -0.6, { dx: 30 });
    this.sub.style.opacity = eo(seg(t, 0.9, 1.5));
    this.sub.style.transform = 'translateX(' + ((1 - eo(seg(t, 0.9, 1.5))) * 26).toFixed(1) + 'px)';
  },
});
