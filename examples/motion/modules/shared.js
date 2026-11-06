// The harbor at blue hour. Scenes stage these drawings; none of them redraws one.
window.W = {
  // Stars from a seeded loop, each on its own slow shimmer (well under once a second).
  stars(kit, n, seed, h) {
    const r = kit.rng(seed), list = Array.from({ length: n }, () => ({ x: r() * 1920, y: r() * (h || 480), s: 1.2 + r() * 2.2, ph: r() * 6.28, sp: 0.5 + r() * 0.9 }));
    return {
      markup: '<g class="stars">' + list.map((p) => '<circle cx="' + p.x.toFixed(0) + '" cy="' + p.y.toFixed(0) + '" r="' + p.s.toFixed(1) + '" style="fill:var(--second)"/>').join('') + '</g>',
      bind(g) { list.forEach((p, i) => { p.el = g.children[i]; }); },
      render(t) { for (const p of list) p.el.style.opacity = (0.55 + 0.3 * Math.sin(t * p.sp + p.ph)).toFixed(2); },
    };
  },
  // A pale moon with a soft halo; the halo is a gradient, so it costs one shape.
  moon(id, x, y, r) {
    return '<defs><radialGradient id="' + id + '"><stop offset="0" style="stop-color:var(--second);stop-opacity:.35"/><stop offset="1" style="stop-color:var(--second);stop-opacity:0"/></radialGradient></defs>' +
      '<g class="moon"><circle cx="' + x + '" cy="' + y + '" r="' + r * 3.2 + '" fill="url(#' + id + ')"/><circle cx="' + x + '" cy="' + y + '" r="' + r + '" style="fill:color-mix(in srgb, var(--second) 92%, var(--accent))"/>' +
      '<circle cx="' + (x - r * 0.3) + '" cy="' + (y - r * 0.2) + '" r="' + r * 0.22 + '" style="fill:color-mix(in srgb, var(--second) 80%, var(--main))"/><circle cx="' + (x + r * 0.35) + '" cy="' + (y + r * 0.3) + '" r="' + r * 0.14 + '" style="fill:color-mix(in srgb, var(--second) 82%, var(--main))"/></g>';
  },
  // The town climbing the hill: houses from a seeded loop, each window its own element so it can come on.
  town(kit, seed, y0) {
    const r = kit.rng(seed), wins = [];
    let s = '<path class="hill" d="M-40 ' + (y0 + 40) + ' Q300 ' + (y0 - 150) + ' 700 ' + (y0 - 90) + ' T1300 ' + (y0 - 40) + ' T1960 ' + (y0 - 10) + ' V' + (y0 + 200) + ' H-40 Z" style="fill:var(--hill)"/><g class="houses">';
    for (let x = 30; x < 1200; x += 70 + r() * 55) {
      const w = 60 + r() * 50, hgt = 60 + r() * 70, base = y0 + 20 - Math.max(0, 120 - Math.abs(x - 600) / 5) * 0.9 + r() * 30, top = base - hgt;
      const tone = Math.round(28 + r() * 26);
      s += '<path d="M' + x + ' ' + base + ' V' + top + ' l' + w / 2 + ' -' + (24 + r() * 16).toFixed(0) + ' l' + w / 2 + ' ' + (24 + r() * 16).toFixed(0) + ' V' + base + ' Z" style="fill:color-mix(in srgb, var(--stone) ' + tone + '%, var(--hill))"/>';
      s += '<path d="M' + (x + w / 2) + ' ' + base + ' V' + top + ' l' + w / 2 + ' 0 V' + base + ' Z" style="fill:color-mix(in srgb, var(--deep) 30%, transparent)"/>';
      const cols = w > 85 ? 2 : 1;
      for (let c = 0; c < cols; c++) {
        const wx = x + (cols === 1 ? w / 2 - 8 : 14 + c * (w - 44)), wy = top + 18 + r() * 14;
        wins.push({ at: r() * 2.4, el: null });
        s += '<rect class="win" x="' + wx.toFixed(0) + '" y="' + wy.toFixed(0) + '" width="16" height="22" rx="2" style="fill:var(--glow)"/>';
      }
    }
    return {
      markup: s + '</g>',
      bind(g) { g.querySelectorAll('.win').forEach((n, i) => { wins[i].el = n; }); },
      // Windows come on one by one after t0, each with a short warm-up.
      render(t, t0) { for (const w of wins) w.el.style.opacity = (0.18 + 0.82 * kit.eo(kit.seg(t, t0 + w.at, t0 + w.at + 0.5))).toFixed(2); },
    };
  },
  // The bay: deep water with a band of light near the horizon.
  sea(id, y) {
    return '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:color-mix(in srgb, var(--sea) 70%, var(--dusk))"/><stop offset=".25" style="stop-color:var(--sea)"/><stop offset="1" style="stop-color:var(--deep)"/></linearGradient></defs>' +
      '<rect class="sea" x="-40" y="' + y + '" width="2000" height="' + (1120 - y) + '" fill="url(#' + id + ')"/>';
  },
  // Ripples: short strokes that drift and fade, each from its own seed and t alone.
  ripples(kit, n, y0, seed) {
    const r = kit.rng(seed), list = Array.from({ length: n }, () => ({ x: r() * 1920, y: y0 + Math.pow(r(), 1.6) * (1080 - y0), w: 30 + r() * 90, ph: r() * 6, sp: 10 + r() * 20 }));
    return {
      markup: '<g class="ripples">' + list.map((p) => '<path style="fill:none;stroke:color-mix(in srgb, var(--second) 40%, transparent);stroke-width:' + (1.5 + (p.y - y0) / 260).toFixed(1) + ';stroke-linecap:round"/>').join('') + '</g>',
      bind(g) { list.forEach((p, i) => { p.el = g.children[i]; }); },
      render(t) {
        for (const p of list) {
          const x = ((p.x + t * p.sp) % 2000) - 40, k = (p.y - y0) / (1080 - y0) + 0.3;
          p.el.setAttribute('d', 'M' + x.toFixed(1) + ' ' + p.y.toFixed(1) + ' q' + (p.w * k / 2).toFixed(1) + ' ' + (-3 * k).toFixed(1) + ' ' + (p.w * k).toFixed(1) + ' 0');
          p.el.style.opacity = (0.5 + 0.5 * Math.sin(t * 0.9 + p.ph)).toFixed(2);
        }
      },
    };
  },
  // The quay: one pattern paints every stone, a capstone runs along the top.
  quay(id, y, x0, x1) {
    return '<defs><pattern id="' + id + '" width="96" height="44" patternUnits="userSpaceOnUse"><rect width="96" height="44" style="fill:color-mix(in srgb, var(--stone) 55%, var(--deep))"/>' +
      '<rect x="2" y="2" width="90" height="18" rx="3" style="fill:var(--stone)"/><rect x="-46" y="24" width="90" height="18" rx="3" style="fill:color-mix(in srgb, var(--stone) 85%, var(--hill))"/><rect x="50" y="24" width="90" height="18" rx="3" style="fill:color-mix(in srgb, var(--stone) 85%, var(--hill))"/></pattern></defs>' +
      '<g class="quay"><rect x="' + x0 + '" y="' + y + '" width="' + (x1 - x0) + '" height="' + (1120 - y) + '" fill="url(#' + id + ')"/><rect x="' + x0 + '" y="' + (y - 16) + '" width="' + (x1 - x0) + '" height="22" rx="4" style="fill:color-mix(in srgb, var(--second) 45%, var(--stone))"/>' +
      '<rect x="' + x0 + '" y="' + y + '" width="' + (x1 - x0) + '" height="' + (1120 - y) + '" style="fill:color-mix(in srgb, var(--deep) 30%, transparent)"/></g>';
  },
};
