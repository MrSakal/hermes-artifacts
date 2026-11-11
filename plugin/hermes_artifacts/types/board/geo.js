/* Board geometry: the text measure rule, shape outlines, orthogonal arrow routing, pen smoothing,
   hit tests, snapping, alignment and layout checks.
   Pure JS, no DOM: window.boardGeo in the page, module.exports under node.
   All coordinates are board units (px at 100 %). */
(function (root) {
  'use strict';

  var isArray = Array.isArray;
  var SIZES = { small: 14, body: 16, large: 28, title: 48, huge: 96 };
  var KINDS = ['rect', 'rounded', 'ellipse', 'diamond', 'pill', 'hexagon', 'parallelogram',
    'database', 'queue', 'document', 'cloud', 'person'];

  // The measure rule (shared with the server's sizing).
  var CHAR_W = 0.55, BOLD_W = 0.6, LINE_H = 1.4, PAD = 16, PAD_SMALL = 12;
  // Routing.
  var STUB = 16;    // shortest leg leaving a box
  var LOOP = 24;    // clearance of a same-side loop
  var CLEAR = 16;   // clearance around an obstacle
  var NEAR = 44;    // facing sides closer than this join with one straight line
  var JOG = 12;     // a sideways step smaller than this is straightened out
  var BEND = 50;    // what a corner costs, in px of length
  var K = 0.5522847498; // cubic circle constant

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function fmt(v) { var r = Math.round(v * 100) / 100; return String(r === 0 ? 0 : r); }
  function r2(v) { return Math.round(v * 100) / 100; }
  function px(size) {
    if (typeof size === 'number' && size > 0) return size;
    return SIZES[size] || SIZES.body;
  }

  // ---------- text

  function stripMarks(text) {
    var t = text == null ? '' : String(text);
    t = t.replace(/\r\n?/g, '\n');
    t = t.replace(/\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*\)/g, '$1');
    t = t.replace(/`([^`\n]*)`/g, '$1');
    t = t.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '$1');
    t = t.replace(/\*(?=[^\s*])([^*\n]*?[^\s*])\*/g, '$1');
    return t;
  }

  // Where a paragraph breaks, as [start, end) offsets: on spaces (the space at a break is dropped), a
  // word longer than a line cut. `max`: characters a line holds (0: no wrapping).
  function wrapRanges(para, max) {
    if (!max || para.length <= max) return [[0, para.length]];
    var out = [], words = para.split(' '), pos = 0, ls = 0, le = 0, has = false;
    for (var j = 0; j < words.length; j++) {
      var wl = words[j].length;
      if (has && le - ls + 1 + wl <= max) { le = pos + wl; pos += wl + 1; continue; }
      if (has) { out.push([ls, le]); has = false; }
      var s = pos, rest = wl;
      while (rest > max) { out.push([s, s + max]); s += max; rest -= max; }
      ls = s; le = s + rest; has = true;
      pos += wl + 1;
    }
    if (has) out.push([ls, le]);
    return out;
  }

  function measure(text, size, wrapW, bold) {
    var p = px(size), cw = p * (bold ? BOLD_W : CHAR_W);
    var paras = stripMarks(text).split('\n'), lines = [], i, j;
    var max = wrapW > 0 ? Math.max(1, Math.floor(wrapW / cw + 1e-9)) : 0;
    for (i = 0; i < paras.length; i++) {
      var rs = wrapRanges(paras[i], max);
      for (j = 0; j < rs.length; j++) lines.push(paras[i].slice(rs[j][0], rs[j][1]));
    }
    var longest = 0;
    for (i = 0; i < lines.length; i++) if (lines[i].length > longest) longest = lines[i].length;
    return { w: r2(longest * cw), h: r2(lines.length * LINE_H * p), lines: lines };
  }

  // The inline marks as the page draws them (code first, then links, bold, italic): one token per
  // character shown, with its style.
  var LIST_LINE = /^(- |\d+\. )(.*)$/;
  function styledTokens(s) {
    var toks = [], i;
    for (i = 0; i < s.length; i++) toks.push({ c: s.charAt(i) });
    function pass(rx, mark) {
      var v = '', kill = {}, m;
      for (i = 0; i < toks.length; i++) v += toks[i].code ? '\u0001' : toks[i].c;
      rx.lastIndex = 0;
      while ((m = rx.exec(v))) mark(m.index, m, kill);
      toks = toks.filter(function (t, k) { return !kill[k]; });
    }
    function wrap(open, close, key) {
      return function (at, m, kill) {
        var end = at + m[0].length;
        for (var k = at; k < at + open; k++) kill[k] = 1;
        for (k = end - close; k < end; k++) kill[k] = 1;
        for (k = at + open; k < end - close; k++) toks[k][key] = key === 'href' ? m.url : true;
      };
    }
    pass(/`([^`\n]+)`/g, wrap(1, 1, 'code'));
    pass(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, function (at, m, kill) {
      var url = '';
      for (var k = at + m[1].length + 3; k < at + m[0].length - 1; k++) url += toks[k].c;
      m.url = url;
      wrap(1, m[0].length - m[1].length - 1, 'href')(at, m, kill);
    });
    pass(/\*\*([^*\n]+)\*\*/g, wrap(2, 2, 'b'));
    pass(/\*([^*\n]+)\*/g, wrap(1, 1, 'i'));
    return toks;
  }
  function runsOf(toks) {
    var out = [], cur = null;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (cur && !!cur.b === !!t.b && !!cur.i === !!t.i && !!cur.code === !!t.code && (cur.href || null) === (t.href || null)) { cur.t += t.c; continue; }
      cur = { t: t.c };
      if (t.b) cur.b = true;
      if (t.i) cur.i = true;
      if (t.code) cur.code = true;
      if (t.href) cur.href = t.href;
      out.push(cur);
    }
    return out;
  }

  // Text as the page shows it, line by line with its styled runs (exports draw these): a `- ` / `1. `
  // line is a list item, left-aligned, indented 1.3 em with its marker on its first line.
  // opts.lists false: no list items (table cells, labels).
  function richLines(text, size, wrapW, opts) {
    var p = px(size), cw = p * CHAR_W, lists = !(opts && opts.lists === false), out = [], i, j;
    var paras = (text == null ? '' : String(text)).replace(/\r\n?/g, '\n').split('\n');
    for (i = 0; i < paras.length; i++) {
      var m = lists ? LIST_LINE.exec(paras[i]) : null, indent = m ? r2(1.3 * p) : 0;
      var toks = styledTokens(m ? m[2] : paras[i]), plain = '';
      for (j = 0; j < toks.length; j++) plain += toks[j].c;
      var room = wrapW > 0 ? Math.max(cw, wrapW - indent) : 0;
      var rs = wrapRanges(plain, room ? Math.max(1, Math.floor(room / cw + 1e-9)) : 0);
      for (j = 0; j < rs.length; j++) {
        var ln = { runs: runsOf(toks.slice(rs[j][0], rs[j][1])), indent: indent };
        if (m && !j) ln.mark = m[1] === '- ' ? '•' : m[1].trim();
        out.push(ln);
      }
    }
    return { lines: out, h: r2(out.length * LINE_H * p) };
  }

  // ---------- shapes
  // A shape is a list of closed subpaths; a subpath is a list of steps: [x, y] (a line to; the
  // first is the start) or [c1x, c1y, c2x, c2y, x, y] (a cubic to).

  function ellipseSegs(cx, cy, rx, ry) {
    var kx = K * rx, ky = K * ry;
    return [[cx - rx, cy],
      [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
      [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
      [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
      [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy]];
  }
  function roundRectSegs(w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (!r) return [[0, 0], [w, 0], [w, h], [0, h]];
    var k = r * (1 - K);
    return [[r, 0], [w - r, 0], [w - k, 0, w, k, w, r], [w, h - r], [w, h - k, w - k, h, w - r, h],
      [r, h], [k, h, 0, h - k, 0, h - r], [0, r], [0, k, k, 0, r, 0]];
  }

  // A circular arc from p to q bulging to the left of the way (outwards when going clockwise on
  // screen), as cubics. bulge = tan(angle / 4): 1 is a half circle.
  function arcSegs(p, q, bulge, out) {
    var dx = q[0] - p[0], dy = q[1] - p[1], c = Math.sqrt(dx * dx + dy * dy);
    var nx = dy / c, ny = -dx / c, s = bulge * c / 2, R = (c * c / 4 + s * s) / (2 * s);
    var cx = (p[0] + q[0]) / 2 + nx * (s - R), cy = (p[1] + q[1]) / 2 + ny * (s - R);
    var a0 = Math.atan2(p[1] - cy, p[0] - cx), th = 4 * Math.atan(bulge);
    var n = Math.max(1, Math.ceil(th / (Math.PI / 2) - 1e-9)), d = th / n, k = 4 / 3 * Math.tan(d / 4) * R;
    for (var i = 0; i < n; i++) {
      var a = a0 + i * d, b = a + d;
      var x0 = cx + R * Math.cos(a), y0 = cy + R * Math.sin(a), x1 = cx + R * Math.cos(b), y1 = cy + R * Math.sin(b);
      out.push([x0 - k * Math.sin(a), y0 + k * Math.cos(a), x1 + k * Math.sin(b), y1 - k * Math.cos(b),
        i === n - 1 ? q[0] : x1, i === n - 1 ? q[1] : y1]);
    }
  }

  // The cloud in a unit square: bumps between cusps, symmetric left to right, stretched to touch
  // all four edges of the square.
  var CLOUD = null;
  function cloudUnit() {
    if (CLOUD) return CLOUD;
    var cusps = [[0.120, 0.540, 0.66], [0.300, 0.280, 0.56], [0.700, 0.280, 0.66], [0.880, 0.540, 0.70],
      [0.800, 0.830, 0.34], [0.500, 0.875, 0.34], [0.200, 0.830, 0.70]];
    var segs = [[cusps[0][0], cusps[0][1]]], i;
    for (i = 0; i < cusps.length; i++) arcSegs(cusps[i], cusps[(i + 1) % cusps.length], cusps[i][2], segs);
    var poly = flatten(segs, 48), x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (i = 0; i < poly.length; i++) {
      x0 = Math.min(x0, poly[i][0]); x1 = Math.max(x1, poly[i][0]);
      y0 = Math.min(y0, poly[i][1]); y1 = Math.max(y1, poly[i][1]);
    }
    CLOUD = segs.map(function (s) {
      var o = [];
      for (var j = 0; j < s.length; j += 2) {
        o.push((s[j] - x0) / (x1 - x0), (s[j + 1] - y0) / (y1 - y0));
      }
      return o;
    });
    return CLOUD;
  }

  function dbRy(w, h) { return Math.max(Math.min(4, h / 4), Math.min(h * 0.18, w * 0.2, 16)); }
  function docAmp(w, h) { return Math.max(Math.min(3, h / 6), Math.min(h * 0.12, 12)); }
  function hexIn(w, h) { return Math.min(w * 0.25, h * 0.5); }
  function paraSkew(w, h) { return Math.min(w * 0.2, h * 0.5); }
  function personDims(w, h) {
    var rh = Math.min(w * 0.22, h * 0.2), yb = 2 * rh + Math.max(Math.min(2, h * 0.02), rh * 0.25);
    return { rh: rh, yb: yb, rr: Math.max(0, Math.min(w / 2, h - yb)) };
  }

  function shapeSegs(kind, w, h) {
    w = Math.max(1, num(w)); h = Math.max(1, num(h));
    var a, k, t;
    switch (kind) {
      case 'rect': return [roundRectSegs(w, h, 0)];
      case 'ellipse': return [ellipseSegs(w / 2, h / 2, w / 2, h / 2)];
      case 'diamond': return [[[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]];
      case 'pill': return [roundRectSegs(w, h, Math.min(w, h) / 2)];
      case 'hexagon':
        a = hexIn(w, h);
        return [[[a, 0], [w - a, 0], [w, h / 2], [w - a, h], [a, h], [0, h / 2]]];
      case 'parallelogram':
        a = paraSkew(w, h);
        return [[[a, 0], [w, 0], [w - a, h], [0, h]]];
      case 'database':
        a = dbRy(w, h); k = K * a; t = K * w / 2;
        return [
          [[0, a], [0, a - k, w / 2 - t, 0, w / 2, 0], [w / 2 + t, 0, w, a - k, w, a], [w, h - a],
            [w, h - a + k, w / 2 + t, h, w / 2, h], [w / 2 - t, h, 0, h - a + k, 0, h - a]],
          // the front of the top rim, there and back so the subpath closes on itself
          [[0, a], [0, a + k, w / 2 - t, 2 * a, w / 2, 2 * a], [w / 2 + t, 2 * a, w, a + k, w, a],
            [w, a + k, w / 2 + t, 2 * a, w / 2, 2 * a], [w / 2 - t, 2 * a, 0, a + k, 0, a]]
        ];
      case 'queue':
        a = Math.max(Math.min(4, w / 4), Math.min(w * 0.18, h * 0.2, 16)); k = K * a; t = K * h / 2;
        return [
          [[a, 0], [w - a, 0], [w - a + k, 0, w, h / 2 - t, w, h / 2], [w, h / 2 + t, w - a + k, h, w - a, h],
            [a, h], [a - k, h, 0, h / 2 + t, 0, h / 2], [0, h / 2 - t, a - k, 0, a, 0]],
          [[a, 0], [a + k, 0, 2 * a, h / 2 - t, 2 * a, h / 2], [2 * a, h / 2 + t, a + k, h, a, h],
            [a + k, h, 2 * a, h / 2 + t, 2 * a, h / 2], [2 * a, h / 2 - t, a + k, 0, a, 0]]
        ];
      case 'document':
        a = docAmp(w, h); k = a * 3.4641;
        return [[[0, 0], [w, 0], [w, h - a], [w * 2 / 3, h - a - k, w / 3, h - a + k, 0, h - a]]];
      case 'cloud':
        return [cloudUnit().map(function (s) {
          var o = [];
          for (var j = 0; j < s.length; j += 2) o.push(s[j] * w, s[j + 1] * h);
          return o;
        })];
      case 'person':
        a = personDims(w, h); k = a.rr * (1 - K);
        return [
          [[0, h], [0, a.yb + a.rr], [0, a.yb + k, k, a.yb, a.rr, a.yb], [w - a.rr, a.yb],
            [w - k, a.yb, w, a.yb + k, w, a.yb + a.rr], [w, h]],
          ellipseSegs(w / 2, a.rh, a.rh, a.rh)
        ];
      default: return [roundRectSegs(w, h, 10)];
    }
  }

  function shapePath(kind, w, h) {
    var subs = shapeSegs(kind, w, h), out = [];
    for (var i = 0; i < subs.length; i++) {
      var s = subs[i];
      for (var j = 0; j < s.length; j++) {
        out.push((j === 0 ? 'M' : s[j].length === 2 ? 'L' : 'C') + s[j].map(fmt).join(' '));
      }
      out.push('Z');
    }
    return out.join(' ');
  }

  function flatten(segs, steps) {
    var out = [[segs[0][0], segs[0][1]]], x = segs[0][0], y = segs[0][1];
    steps = steps || 10;
    for (var i = 1; i < segs.length; i++) {
      var s = segs[i];
      if (s.length === 2) { out.push([s[0], s[1]]); x = s[0]; y = s[1]; continue; }
      for (var k = 1; k <= steps; k++) {
        var t = k / steps, u = 1 - t;
        out.push([u * u * u * x + 3 * u * u * t * s[0] + 3 * u * t * t * s[2] + t * t * t * s[4],
          u * u * u * y + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5]]);
      }
      x = s[4]; y = s[5];
    }
    return out;
  }

  // The outline as polygons (one per subpath that encloses an area), at 0,0.
  var polyKey = '', polyVal = null;
  function shapePoly(kind, w, h) {
    var key = kind + '/' + w + '/' + h;
    if (key === polyKey) return polyVal;
    var subs = shapeSegs(kind, w, h), out = [];
    for (var i = 0; i < subs.length; i++) {
      if (i === 1 && (kind === 'database' || kind === 'queue')) continue; // the rim encloses nothing
      out.push(flatten(subs[i], 12));
    }
    polyKey = key; polyVal = out;
    return out;
  }

  function inPoly(poly, x, y) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  // Where the outline is met when coming straight in at a side: `at` is the y (left/right) or
  // the x (top/bottom) of the incoming line in the shape's own coordinates; absent = the middle.
  function shapeEdge(kind, w, h, side, at) {
    var horiz = side === 'left' || side === 'right';
    var first = side === 'left' || side === 'top';
    if (at == null) at = horiz ? h / 2 : w / 2;
    var fall = horiz ? { x: first ? 0 : w, y: at } : { x: at, y: first ? 0 : h };
    if (kind === 'rect' || !kind) return fall;
    var polys = shapePoly(kind, w, h), best = null, i, j;
    for (i = 0; i < polys.length; i++) {
      var p = polys[i];
      for (j = 0; j < p.length; j++) {
        var a = p[j], b = p[(j + 1) % p.length];
        var a0 = horiz ? a[1] : a[0], b0 = horiz ? b[1] : b[0], a1 = horiz ? a[0] : a[1], b1 = horiz ? b[0] : b[1];
        if ((a0 - at) * (b0 - at) > 0) continue;
        var v = a0 === b0 ? (first ? Math.min(a1, b1) : Math.max(a1, b1)) : a1 + (b1 - a1) * (at - a0) / (b0 - a0);
        if (best === null || (first ? v < best : v > best)) best = v;
      }
    }
    if (best === null) return fall;
    return horiz ? { x: best, y: at } : { x: at, y: best };
  }

  function clampBox(b, w, h) {
    var x = Math.max(0, Math.min(b.x, w / 2 - 0.5)), y = Math.max(0, Math.min(b.y, h / 2 - 0.5));
    return { x: r2(x), y: r2(y), w: r2(Math.max(1, Math.min(b.w, w - 2 * x))), h: r2(Math.max(1, Math.min(b.h, h - y))) };
  }

  function shapeInset(kind, w, h) {
    w = Math.max(1, num(w)); h = Math.max(1, num(h));
    var px0 = Math.min(PAD, w / 4), py0 = Math.min(PAD, h / 4);
    var sx = Math.min(PAD_SMALL, w / 4), sy = Math.min(PAD_SMALL, h / 4);
    var a, b, x, y;
    switch (kind) {
      case 'ellipse':
        return clampBox({ x: w * 0.1464 + 1, y: h * 0.1464 + 1, w: w * 0.7071 - 2, h: h * 0.7071 - 2 }, w, h);
      case 'diamond':
        return clampBox({ x: w / 4 + 1, y: h / 4 + 1, w: w / 2 - 2, h: h / 2 - 2 }, w, h);
      case 'pill':
        a = Math.min(w, h) / 2;
        x = w >= h ? Math.max(sx, a * 0.5) : Math.max(sx, a * 0.134 + 1);
        y = w >= h ? Math.max(Math.min(sy, h / 5), a * 0.134 + 1) : Math.max(sy, a * 0.5);
        return clampBox({ x: x, y: y, w: w - 2 * x, h: h - 2 * y }, w, h);
      case 'hexagon':
        a = hexIn(w, h); x = a * 0.8 + 2; y = h * 0.125;
        return clampBox({ x: x, y: y, w: w - 2 * x, h: h - 2 * y }, w, h);
      case 'parallelogram':
        a = paraSkew(w, h); x = a + 4;
        return clampBox({ x: x, y: sy, w: w - 2 * x, h: h - 2 * sy }, w, h);
      case 'database':
        a = dbRy(w, h);
        return clampBox({ x: sx, y: 2 * a + 3, w: w - 2 * sx, h: h - 3 * a - 4 }, w, h);
      case 'queue':
        a = Math.max(Math.min(4, w / 4), Math.min(w * 0.18, h * 0.2, 16));
        return { x: r2(2 * a + 4), y: r2(sy), w: r2(Math.max(1, w - 3 * a - 6)), h: r2(Math.max(1, h - 2 * sy)) };
      case 'document':
        a = docAmp(w, h);
        return { x: r2(px0), y: r2(py0), w: r2(w - 2 * px0), h: r2(Math.max(1, h - py0 - 2 * a - 4)) };
      case 'cloud':
        return { x: r2(w * 0.2), y: r2(h * 0.27), w: r2(w * 0.6), h: r2(h * 0.5) };
      case 'person':
        a = personDims(w, h); b = a.rr * 0.293 + 1;
        return { x: r2(b), y: r2(a.yb + b), w: r2(Math.max(1, w - 2 * b)), h: r2(Math.max(1, h - a.yb - b - Math.min(4, h * 0.03))) };
      default: // rect, rounded
        return { x: r2(px0), y: r2(py0), w: r2(w - 2 * px0), h: r2(h - 2 * py0) };
    }
  }

  // ---------- items

  function lookup(itemsById) {
    if (!itemsById) return function () { return null; };
    if (typeof itemsById === 'function') return itemsById;
    if (isArray(itemsById)) {
      var m = {};
      for (var i = 0; i < itemsById.length; i++) if (itemsById[i] && itemsById[i].id != null) m[itemsById[i].id] = itemsById[i];
      return function (id) { return Object.prototype.hasOwnProperty.call(m, id) ? m[id] : null; };
    }
    if (typeof itemsById.get === 'function') return function (id) { return itemsById.get(id) || null; };
    return function (id) { return Object.prototype.hasOwnProperty.call(itemsById, id) ? itemsById[id] : null; };
  }

  var DEF = { box: [180, 60], note: [160, 160], section: [400, 300], image: [200, 150], drawing: [200, 150], embed: [320, 240] };

  function tableLayout(item) {
    var rows = item && isArray(item.rows) ? item.rows : [], given = item && isArray(item.colw) ? item.colw : [];
    var n = 0, i, j, colw = [], rowh = [], w = 0, h = 0;
    for (i = 0; i < rows.length; i++) if (isArray(rows[i]) && rows[i].length > n) n = rows[i].length;
    for (j = 0; j < n; j++) {
      if (given[j] > 0) { colw.push(Math.max(40, given[j])); continue; }
      var cw = 80;
      for (i = 0; i < rows.length; i++) {
        var c = rows[i] && rows[i][j];
        if (c != null && c !== '') cw = Math.max(cw, measure(c, SIZES.body, 0, i === 0).w + 20);
      }
      colw.push(r2(Math.min(cw, 360)));
    }
    for (i = 0; i < rows.length; i++) {
      var rh = LINE_H * SIZES.body;
      for (j = 0; j < n; j++) {
        var cell = rows[i] && rows[i][j];
        if (cell != null && cell !== '') rh = Math.max(rh, measure(cell, SIZES.body, colw[j] - 20, i === 0).h);
      }
      rowh.push(r2(rh + 16));
    }
    for (j = 0; j < n; j++) w += colw[j];
    for (i = 0; i < rowh.length; i++) h += rowh[i];
    return { colw: colw, rowh: rowh, w: r2(w), h: r2(h) };
  }

  function penBox(item) {
    var p = item.points || [], x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    for (var i = 0; i + 1 < p.length; i += 2) {
      if (i === 0) { x0 = x1 = p[0]; y0 = y1 = p[1]; continue; }
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
    }
    return { x: num(item.x) + x0, y: num(item.y) + y0, w: x1 - x0, h: y1 - y0 };
  }

  function bounds(item, itemsById, _depth) {
    if (!item) return { x: 0, y: 0, w: 0, h: 0 };
    var x = num(item.x), y = num(item.y), t = item.type, m;
    if (t === 'arrow') {
      var rt = (_depth || 0) > 0 ? null : arrowRoute(item, itemsById);
      if (!rt) return { x: 0, y: 0, w: 0, h: 0 };
      return ptsBox(rt.pts);
    }
    if (t === 'pen') return penBox(item);
    if (t === 'table') { m = tableLayout(item); return { x: x, y: y, w: m.w, h: m.h }; }
    if (t === 'text') {
      m = measure(item.text, item.size, item.w > 0 ? item.w : 0);
      return { x: x, y: y, w: item.w > 0 ? item.w : m.w, h: m.h };
    }
    var d = DEF[t] || DEF.box, w = item.w > 0 ? item.w : d[0], h = item.h;
    if (!(h > 0)) {
      h = d[1];
      if (t === 'box' || t === 'note') {
        var ins = shapeInset(t === 'box' ? item.kind || 'rounded' : 'rect', w, h);
        h = Math.max(h, measure(item.text, item.size, ins.w).h + 2 * PAD);
      }
    }
    return { x: x, y: y, w: w, h: h };
  }

  function ptsBox(pts) {
    var x0 = pts[0][0], y0 = pts[0][1], x1 = x0, y1 = y0;
    for (var i = 1; i < pts.length; i++) {
      if (pts[i][0] < x0) x0 = pts[i][0]; if (pts[i][0] > x1) x1 = pts[i][0];
      if (pts[i][1] < y0) y0 = pts[i][1]; if (pts[i][1] > y1) y1 = pts[i][1];
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function anchor(rect, side) {
    var x = num(rect.x), y = num(rect.y), w = num(rect.w), h = num(rect.h);
    if (side === 'top') return { x: x + w / 2, y: y };
    if (side === 'bottom') return { x: x + w / 2, y: y + h };
    if (side === 'left') return { x: x, y: y + h / 2 };
    return { x: x + w, y: y + h / 2 };
  }

  // ---------- routing

  var SIDE_DIR = { right: 0, bottom: 1, left: 2, top: 3 };
  var DIR_SIDE = ['right', 'bottom', 'left', 'top'];
  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

  function endOf(e) {
    if (e && e.rect) {
      var r = e.rect;
      return { rect: { x: num(r.x), y: num(r.y), w: Math.max(0, num(r.w)), h: Math.max(0, num(r.h)) }, pt: false, kind: e.kind || null };
    }
    var p = e && e.pt ? e.pt : e;
    var x = p ? (isArray(p) ? num(p[0]) : num(p.x)) : 0, y = p ? (isArray(p) ? num(p[1]) : num(p.y)) : 0;
    return { rect: { x: x, y: y, w: 0, h: 0 }, pt: true, kind: null };
  }
  // The middle of a side, or E.at from it along the side (a slot, geo.slots), kept 6 from the corners.
  function anchorOf(E, d) {
    var r = E.rect, o = E.at || 0, hz = d === 0 || d === 2, room = Math.max(0, (hz ? r.h : r.w) / 2 - 6);
    o = Math.max(-room, Math.min(room, o));
    if (d === 0) return [r.x + r.w, r.y + r.h / 2 + o];
    if (d === 1) return [r.x + r.w / 2 + o, r.y + r.h];
    if (d === 2) return [r.x, r.y + r.h / 2 + o];
    return [r.x + r.w / 2 + o, r.y];
  }

  // The pair of sides that face each other: across the wider gap.
  function facing(A, B) {
    var gx = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w)), gy = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
    var dx = B.x + B.w / 2 - (A.x + A.w / 2), dy = B.y + B.h / 2 - (A.y + A.h / 2);
    var horiz = gx < 0 && gy < 0 ? Math.abs(dx) >= Math.abs(dy) : gx >= gy;
    if (horiz) return dx >= 0 ? [0, 2] : [2, 0];
    return dy >= 0 ? [1, 3] : [3, 1];
  }

  // An orthogonal leg against a rect's inside.
  function legHits(a, b, x1, y1, x2, y2) {
    if (a[1] === b[1]) return a[1] > y1 && a[1] < y2 && Math.max(a[0], b[0]) > x1 && Math.min(a[0], b[0]) < x2;
    if (a[0] === b[0]) return a[0] > x1 && a[0] < x2 && Math.max(a[1], b[1]) > y1 && Math.min(a[1], b[1]) < y2;
    return segRect(a[0], a[1], b[0], b[1], x1, y1, x2, y2);
  }
  function crosses(pts, r, shrink) {
    var x1 = r.x + shrink, y1 = r.y + shrink, x2 = r.x + r.w - shrink, y2 = r.y + r.h - shrink;
    if (x2 <= x1 || y2 <= y1) return false;
    for (var i = 0; i + 1 < pts.length; i++) if (legHits(pts[i], pts[i + 1], x1, y1, x2, y2)) return true;
    return false;
  }
  function clearOfEnds(pts, A, B) {
    return !(!A.pt && crosses(pts, A.rect, 0.5)) && !(!B.pt && crosses(pts, B.rect, 0.5));
  }

  // One straight line between facing sides: when the middles line up, or the sides overlap
  // enough and are close or only a small step apart.
  function straight(A, fa, B, S, T) {
    var horiz = fa === 0 || fa === 2, al = horiz ? 0 : 1, la = 1 - al;
    var D = (T[al] - S[al]) * (horiz ? DX[fa] : DY[fa]);
    if (D <= 0.5) return null;
    var off = Math.abs(S[la] - T[la]);
    if (off < 0.5) return [S, T];
    if (A.pt && B.pt) return null;
    var a0 = horiz ? A.rect.y : A.rect.x, a1 = a0 + (horiz ? A.rect.h : A.rect.w);
    var b0 = horiz ? B.rect.y : B.rect.x, b1 = b0 + (horiz ? B.rect.h : B.rect.w), at, s, t;
    if (A.pt || B.pt) {
      var p = A.pt ? a0 : b0, o0 = A.pt ? b0 : a0, o1 = A.pt ? b1 : a1;
      if (p < o0 + 6 || p > o1 - 6) return null;
      s = S.slice(); t = T.slice(); s[la] = p; t[la] = p; // a loose end is simply met where it is
      return [s, t];
    } else {
      var lo = Math.max(a0, b0), hi = Math.min(a1, b1);
      if (hi - lo < Math.min(24, 0.6 * Math.min(a1 - a0, b1 - b0))) return null;
      at = (lo + hi) / 2;
      // an end on a slot keeps it (the line runs there when the other side reaches that far)
      var slotted = false;
      if (A.at && S[la] >= lo + 6 && S[la] <= hi - 6) { at = S[la]; slotted = true; }
      else if (B.at && T[la] >= lo + 6 && T[la] <= hi - 6) { at = T[la]; slotted = true; }
    }
    if (!slotted && !(D < NEAR || off < JOG)) return null;
    s = S.slice(); t = T.slice();
    s[la] = at; t[la] = at;
    return [s, t];
  }

  // The hand-drawn answers: a Z between facing sides, an L between neighbouring sides, a U
  // between two sides that look the same way.
  function simple(A, fa, B, fb, S, T, auto) {
    var rel = (fb - fa + 4) % 4, horiz = fa === 0 || fa === 2;
    if (rel === 2) {
      var D = (T[0] - S[0]) * DX[fa] + (T[1] - S[1]) * DY[fa];
      if (!(D >= 2 * STUB || (auto && D >= 8))) return null;
      var m = horiz ? (S[0] + T[0]) / 2 : (S[1] + T[1]) / 2;
      return horiz ? [S, [m, S[1]], [m, T[1]], T] : [S, [S[0], m], [T[0], m], T];
    }
    if (rel === 0) {
      var ra = A.rect, rb = B.rect, far;
      if (fa === 0) far = Math.max(ra.x + ra.w, rb.x + rb.w) + LOOP;
      else if (fa === 2) far = Math.min(ra.x, rb.x) - LOOP;
      else if (fa === 1) far = Math.max(ra.y + ra.h, rb.y + rb.h) + LOOP;
      else far = Math.min(ra.y, rb.y) - LOOP;
      if (horiz) return Math.abs(S[1] - T[1]) < 1 ? null : [S, [far, S[1]], [far, T[1]], T];
      return Math.abs(S[0] - T[0]) < 1 ? null : [S, [S[0], far], [T[0], far], T];
    }
    var C = horiz ? [T[0], S[1]] : [S[0], T[1]];
    var ea = (C[0] - S[0]) * DX[fa] + (C[1] - S[1]) * DY[fa], eb = (C[0] - T[0]) * DX[fb] + (C[1] - T[1]) * DY[fb];
    if (ea >= (A.pt ? 1 : STUB) && eb >= (B.pt ? 1 : STUB)) return [S, C, T];
    return null;
  }

  function uniq(a) {
    a.sort(function (p, q) { return p - q; });
    var o = [];
    for (var i = 0; i < a.length; i++) if (!o.length || a[i] - o[o.length - 1] > 0.01) o.push(a[i]);
    return o;
  }
  function at(a, v) {
    for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - v) <= 0.01) return i;
    return -1;
  }

  var hc = [], hs = []; // the search's heap: keys and states
  function heapPush(c, s) {
    var p = hc.length;
    hc.push(c); hs.push(s);
    while (p > 0) {
      var q = (p - 1) >> 1;
      if (hc[q] <= c) break;
      hc[p] = hc[q]; hs[p] = hs[q]; p = q;
    }
    hc[p] = c; hs[p] = s;
  }
  function heapPop() {
    var top = hs[0], c = hc.pop(), s = hs.pop(), n = hc.length, p = 0;
    if (n) {
      for (;;) {
        var l = 2 * p + 1, r = l + 1, m = l;
        if (l >= n) break;
        if (r < n && hc[r] < hc[l]) m = r;
        if (hc[m] >= c) break;
        hc[p] = hc[m]; hs[p] = hs[m]; p = m;
      }
      hc[p] = c; hs[p] = s;
    }
    return top;
  }

  // Cheapest orthogonal way from a to b over the lines xs × ys: length plus BEND a corner, never
  // through the inside of a block. da: the way a is entered (-1: any); db: the way b must be left
  // (-1: any). prefX / prefY: lines that win a tie.
  function search(a, da, b, db, blocks, xs, ys, prefX, prefY) {
    xs = uniq(xs); ys = uniq(ys);
    var nx = xs.length, ny = ys.length, i, j, k, e = 0.01;
    var ax = at(xs, a[0]), ay = at(ys, a[1]), bx = at(xs, b[0]), by = at(ys, b[1]);
    if (ax < 0 || ay < 0 || bx < 0 || by < 0) return null;
    var hb = new Uint8Array(nx * ny), vb = new Uint8Array(nx * ny);
    for (k = 0; k < blocks.length; k++) {
      var B = blocks[k];
      for (j = 0; j < ny; j++) {
        var yin = ys[j] > B.y1 + e && ys[j] < B.y2 - e;
        for (i = 0; i < nx; i++) {
          if (yin && i + 1 < nx && xs[i] < B.x2 - e && xs[i + 1] > B.x1 + e) hb[j * nx + i] = 1;
          if (j + 1 < ny && xs[i] > B.x1 + e && xs[i] < B.x2 - e && ys[j] < B.y2 - e && ys[j + 1] > B.y1 + e) vb[j * nx + i] = 1;
        }
      }
    }
    var wx = [], wy = [];
    for (i = 0; i < nx; i++) wx.push(prefX && at(prefX, xs[i]) >= 0 ? 0 : 0.002);
    for (j = 0; j < ny; j++) wy.push(prefY && at(prefY, ys[j]) >= 0 ? 0 : 0.002);

    var N = nx * ny * 4, dist = new Float64Array(N), prev = new Int32Array(N);
    for (i = 0; i < N; i++) { dist[i] = Infinity; prev[i] = -1; }
    hc.length = 0; hs.length = 0;
    var gx = xs[bx], gy = ys[by];
    var start = (ay * nx + ax) * 4;
    var h0 = Math.abs(xs[ax] - gx) + Math.abs(ys[ay] - gy);
    for (k = 0; k < 4; k++) if (da < 0 || da === k) { dist[start + k] = 0; heapPush(h0, start + k); }
    var best = Infinity, bestS = -1;
    while (hc.length) {
      var f = hc[0], s = heapPop();
      if (f >= best) break;
      var c = dist[s], d = s & 3, node = s >> 2, ix = node % nx, iy = (node - ix) / nx;
      if (f > c + Math.abs(xs[ix] - gx) + Math.abs(ys[iy] - gy) + 1e-9) continue; // an old entry
      if (ix === bx && iy === by) {
        var extra = db < 0 || d === db ? 0 : d === (db + 2) % 4 ? Infinity : BEND;
        if (c + extra < best) { best = c + extra; bestS = s; }
        continue;
      }
      for (var nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue;
        var jx = ix + DX[nd], jy = iy + DY[nd], len, w;
        if (jx < 0 || jy < 0 || jx >= nx || jy >= ny) continue;
        if (nd === 0) { if (hb[iy * nx + ix]) continue; len = xs[jx] - xs[ix]; w = wy[iy]; }
        else if (nd === 2) { if (hb[iy * nx + jx]) continue; len = xs[ix] - xs[jx]; w = wy[iy]; }
        else if (nd === 1) { if (vb[iy * nx + ix]) continue; len = ys[jy] - ys[iy]; w = wx[ix]; }
        else { if (vb[jy * nx + ix]) continue; len = ys[iy] - ys[jy]; w = wx[ix]; }
        var nc = c + len * (1 + w) + (nd !== d ? BEND : 0), ns = (jy * nx + jx) * 4 + nd;
        if (nc < dist[ns] - 1e-9) { dist[ns] = nc; prev[ns] = s; heapPush(nc + Math.abs(xs[jx] - gx) + Math.abs(ys[jy] - gy), ns); }
      }
    }
    if (bestS < 0) return null;
    var out = [];
    for (s = bestS; s >= 0; s = prev[s]) {
      node = s >> 2; ix = node % nx; iy = (node - ix) / nx;
      out.push([xs[ix], ys[iy]]);
    }
    out.reverse();
    return out;
  }

  function zone(r, m) { return { x1: r.x - m, y1: r.y - m, x2: r.x + r.w + m, y2: r.y + r.h + m }; }
  function within(p, z) { return p[0] > z.x1 + 0.01 && p[0] < z.x2 - 0.01 && p[1] > z.y1 + 0.01 && p[1] < z.y2 - 0.01; }

  // The searched route between two ends: leaves and arrives by a stub, keeps STUB away from both
  // boxes and CLEAR away from the given obstacles.
  // The first point off a box: a stub out of its side, shorter when a block sits close in front of it
  // (a row 24 px below), so the route can still turn away before it; a loose end is its own point.
  var STUBS = [STUB, 10, 6, 3];
  function stubFrom(E, P, d, obst) {
    if (E.pt) return { p: P, len: 0 };
    for (var k = 0; k < STUBS.length; k++) {
      var q = [P[0] + DX[d] * STUBS[k], P[1] + DY[d] * STUBS[k]], free = true;
      for (var i = 0; i < obst.length && free; i++) if (within(q, zone(obst[i], 1)) || crosses([P, q], obst[i], -1)) free = false;
      if (free) return { p: q, len: STUBS[k] };
    }
    return { p: [P[0] + DX[d] * STUB, P[1] + DY[d] * STUB], len: STUB };
  }
  function gridPlan(A, fa, B, fb, S, T, obst) {
    var sa = stubFrom(A, S, fa, obst), sb = stubFrom(B, T, fb, obst), a = sa.p, b = sb.p;
    var da = A.pt ? -1 : fa, db = B.pt ? -1 : (fb + 2) % 4, ra = A.rect, rb = B.rect, i;
    var margins = [STUB, 1];
    for (var k = 0; k < margins.length; k++) {
      var m = margins[k], blocks = [], xs = [a[0], b[0]], ys = [a[1], b[1]], prefX = [], prefY = [];
      if (!A.pt) blocks.push(zone(ra, Math.min(m, sa.len)));
      if (!B.pt) blocks.push(zone(rb, Math.min(m, sb.len)));
      var bad = false;
      for (i = 0; i < blocks.length; i++) if (within(a, blocks[i]) || within(b, blocks[i])) bad = true;
      if (bad) continue;
      for (i = 0; i < obst.length; i++) {
        // CLEAR round a block; on the one side where an end's first point sits nearer than that, half
        // way to it (the other sides keep their room)
        var o = obst[i], z = zone(o, CLEAR), inside = false;
        [a, b].forEach(function (p) {
          if (inside || !within(p, z)) return;
          if (p[1] <= o.y) z.y1 = (p[1] + o.y) / 2;
          else if (p[1] >= o.y + o.h) z.y2 = (p[1] + o.y + o.h) / 2;
          else if (p[0] <= o.x) z.x1 = (p[0] + o.x) / 2;
          else if (p[0] >= o.x + o.w) z.x2 = (p[0] + o.x + o.w) / 2;
          else inside = true;
        });
        if (inside || within(a, z) || within(b, z)) continue;   // an end in the block itself: no way round it
        blocks.push(z);
      }
      for (i = 0; i < blocks.length; i++) { xs.push(blocks[i].x1, blocks[i].x2); ys.push(blocks[i].y1, blocks[i].y2); }
      xs.push(Math.min(ra.x, rb.x) - LOOP, Math.max(ra.x + ra.w, rb.x + rb.w) + LOOP);
      ys.push(Math.min(ra.y, rb.y) - LOOP, Math.max(ra.y + ra.h, rb.y + rb.h) + LOOP);
      if (rb.x > ra.x + ra.w) prefX.push((ra.x + ra.w + rb.x) / 2); else if (ra.x > rb.x + rb.w) prefX.push((rb.x + rb.w + ra.x) / 2);
      if (rb.y > ra.y + ra.h) prefY.push((ra.y + ra.h + rb.y) / 2); else if (ra.y > rb.y + rb.h) prefY.push((rb.y + rb.h + ra.y) / 2);
      var p = search(a, da, b, db, blocks, xs.concat(prefX), ys.concat(prefY), prefX, prefY);
      if (p) return [S].concat(p, [T]);
    }
    return null;
  }

  function naive(S, fa, T, fb, A, B) {
    var a = A.pt ? S : [S[0] + DX[fa] * STUB, S[1] + DY[fa] * STUB];
    var b = B.pt ? T : [T[0] + DX[fb] * STUB, T[1] + DY[fb] * STUB];
    return [S, a, fa === 0 || fa === 2 ? [a[0], b[1]] : [b[0], a[1]], b, T];
  }

  function tidy(pts) {
    var o = [], i;
    for (i = 0; i < pts.length; i++) o.push([pts[i][0], pts[i][1]]);
    for (i = 1; i < o.length;) {
      var a = o[i - 1], b = o[i], c = o[i + 1];
      var same = Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
      if (same && o.length > 2) { o.splice(i, 1); if (i > 1) i--; continue; }
      if (c && ((Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) || (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01))) {
        o.splice(i, 1);
        if (i > 1) i--;
      } else i++;
    }
    return o;
  }
  function pathLen(pts) {
    var l = 0;
    for (var i = 0; i + 1 < pts.length; i++) l += Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
    return l;
  }
  function cost(pts) { return (pts.length - 2) * BEND + pathLen(pts); }

  // The route between two ends with both sides known, obstacles ignored. Never null.
  function plan(A, fa, B, fb, auto) {
    var S = anchorOf(A, fa), T = anchorOf(B, fb), p;
    if (fb === (fa + 2) % 4) {
      p = straight(A, fa, B, S, T);
      if (p) return p;
    }
    p = simple(A, fa, B, fb, S, T, auto);
    if (p && clearOfEnds(p, A, B)) return tidy(p);
    p = gridPlan(A, fa, B, fb, S, T, []);
    return tidy(p || naive(S, fa, T, fb, A, B));
  }

  function hitsOf(pts, obst) {
    var o = [];
    for (var i = 0; i < obst.length; i++) if (crosses(pts, obst[i], 1)) o.push(obst[i]);
    return o;
  }

  // The same, going round the obstacles the route would cross: null when no clean way is found.
  function detour(A, fa, B, fb, obst, first) {
    var S = anchorOf(A, fa), T = anchorOf(B, fb), active = [], hits = first, i;
    for (var round = 0; round < 4; round++) {
      var grew = false;
      for (i = 0; i < hits.length; i++) if (active.indexOf(hits[i]) < 0) { active.push(hits[i]); grew = true; }
      if (!grew) return null;
      var p = gridPlan(A, fa, B, fb, S, T, active);
      if (!p) return null;
      p = tidy(p);
      hits = hitsOf(p, obst);
      if (!hits.length) return p;
    }
    return null;
  }

  function plainRoute(A, B, fs, ts, obst) {
    var fa, fb, auto = fs == null && ts == null, base, k;
    if (auto) { k = facing(A.rect, B.rect); fa = k[0]; fb = k[1]; base = plan(A, fa, B, fb, true); }
    else if (fs != null && ts != null) { fa = fs; fb = ts; base = plan(A, fa, B, fb, false); }
    else {
      // one side is fixed: the other is the one that gives the plainest route
      var known = fs != null ? fs : ts, order = [(known + 2) % 4, (known + 1) % 4, (known + 3) % 4, known], bestC = Infinity;
      for (k = 0; k < 4; k++) {
        var ca = fs != null ? fs : order[k], cb = ts != null ? ts : order[k];
        var p = plan(A, ca, B, cb, false), c = cost(p) + k * 0.01 + (clearOfEnds(p, A, B) ? 0 : 1e6);
        if (c < bestC) { bestC = c; base = p; fa = ca; fb = cb; }
      }
    }
    var res = { pts: base, fa: fa, fb: fb };
    if (!obst.length) return res;
    var hits = hitsOf(base, obst);
    if (!hits.length) return res;
    var cands = [[fa, fb]], bestP = null, bestCost = Infinity;
    if (auto && !A.pt && !B.pt) {
      // boxes side by side: over or under both; stacked: left or right of both
      cands.push([(fa + 1) % 4, (fa + 1) % 4], [(fa + 3) % 4, (fa + 3) % 4]);
    }
    for (k = 0; k < cands.length; k++) {
      var q = k === 0 ? detour(A, fa, B, fb, obst, hits) : null;
      if (k > 0) {
        q = plan(A, cands[k][0], B, cands[k][1], false);
        var h = hitsOf(q, obst);
        if (h.length) q = detour(A, cands[k][0], B, cands[k][1], obst, h);
      }
      if (!q || !clearOfEnds(q, A, B)) continue;
      var qc = cost(q) + k * 0.01;
      if (qc < bestCost) { bestCost = qc; bestP = q; res = { pts: q, fa: cands[k][0], fb: cands[k][1] }; }
      if (k === 0 && q.length <= 4) break; // a plain Z past the obstacle: other sides gain nothing
    }
    return bestP ? res : { pts: base, fa: fa, fb: fb };
  }

  // Through the waypoints in order: each stretch is searched on its own, entered the way the
  // last one arrived, so the line never doubles back at a waypoint unless it has to.
  function viaRoute(A, B, fs, ts, via) {
    var first = { x: via[0][0], y: via[0][1], w: 0, h: 0 }, lastV = via[via.length - 1];
    var last = { x: lastV[0], y: lastV[1], w: 0, h: 0 };
    var fa = fs != null ? fs : facing(A.rect, first)[0], fb = ts != null ? ts : facing(last, B.rect)[1];
    var S = anchorOf(A, fa), T = anchorOf(B, fb);
    var a = A.pt ? S : [S[0] + DX[fa] * STUB, S[1] + DY[fa] * STUB];
    var b = B.pt ? T : [T[0] + DX[fb] * STUB, T[1] + DY[fb] * STUB];
    var stops = [a].concat(via, [b]), pts = [S, a], dir = A.pt ? -1 : fa, i, k;
    var ra = A.rect, rb = B.rect;
    for (i = 0; i + 1 < stops.length; i++) {
      var p = stops[i], q = stops[i + 1], db = i + 2 === stops.length && !B.pt ? (fb + 2) % 4 : -1, got = null;
      var margins = [STUB, 1, -1];
      for (k = 0; k < margins.length && !got; k++) {
        var blocks = [], xs = [p[0], q[0]], ys = [p[1], q[1]], j, bad = false;
        if (margins[k] >= 0) {
          if (!A.pt) blocks.push(zone(ra, margins[k]));
          if (!B.pt) blocks.push(zone(rb, margins[k]));
        }
        for (j = 0; j < blocks.length; j++) {
          if (within(p, blocks[j]) || within(q, blocks[j])) bad = true;
          xs.push(blocks[j].x1, blocks[j].x2); ys.push(blocks[j].y1, blocks[j].y2);
        }
        if (bad) continue;
        got = search(p, dir, q, db, blocks, xs, ys, null, null);
      }
      if (!got) got = [p, [q[0], p[1]], q];
      for (k = 1; k < got.length; k++) pts.push(got[k]);
      var n = got.length;
      if (n > 1) {
        var ex = got[n - 1][0] - got[n - 2][0], ey = got[n - 1][1] - got[n - 2][1];
        if (Math.abs(ex) > 0.01 || Math.abs(ey) > 0.01) dir = Math.abs(ex) > Math.abs(ey) ? (ex > 0 ? 0 : 2) : (ey > 0 ? 1 : 3);
      }
    }
    pts.push(T);
    return { pts: tidy(pts), fa: fa, fb: fb };
  }

  function roundedPath(pts, r) {
    var d = 'M' + fmt(pts[0][0]) + ' ' + fmt(pts[0][1]);
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i];
      if (i === pts.length - 1 || !(r > 0)) { d += ' L' + fmt(p[0]) + ' ' + fmt(p[1]); continue; }
      var a = pts[i - 1], b = pts[i + 1];
      var la = Math.sqrt((p[0] - a[0]) * (p[0] - a[0]) + (p[1] - a[1]) * (p[1] - a[1]));
      var lb = Math.sqrt((b[0] - p[0]) * (b[0] - p[0]) + (b[1] - p[1]) * (b[1] - p[1]));
      var c = Math.min(r, la / 2, lb / 2);
      if (!(c > 0.01)) { d += ' L' + fmt(p[0]) + ' ' + fmt(p[1]); continue; }
      d += ' L' + fmt(p[0] + (a[0] - p[0]) / la * c) + ' ' + fmt(p[1] + (a[1] - p[1]) / la * c) +
        ' Q' + fmt(p[0]) + ' ' + fmt(p[1]) + ' ' + fmt(p[0] + (b[0] - p[0]) / lb * c) + ' ' + fmt(p[1] + (b[1] - p[1]) / lb * c);
    }
    return d;
  }

  function legDir(a, b) {
    var ex = b[0] - a[0], ey = b[1] - a[1];
    if (Math.abs(ex) < 0.01 && Math.abs(ey) < 0.01) return -1;
    return Math.abs(ex) >= Math.abs(ey) ? (ex > 0 ? 0 : 2) : (ey > 0 ? 1 : 3);
  }

  function route(from, to, opts) {
    opts = opts || {};
    var A = endOf(from), B = endOf(to), i;
    if (!A.pt && num(opts.fromAt)) A.at = num(opts.fromAt);
    if (!B.pt && num(opts.toAt)) B.at = num(opts.toAt);
    var r = opts.r == null ? 8 : Math.max(0, num(opts.r));
    var fs = A.pt || !(opts.fromSide in SIDE_DIR) ? null : SIDE_DIR[opts.fromSide];
    var ts = B.pt || !(opts.toSide in SIDE_DIR) ? null : SIDE_DIR[opts.toSide];
    var via = [], obst = [];
    if (isArray(opts.via)) {
      for (i = 0; i < opts.via.length; i++) {
        var v = opts.via[i];
        if (v && isFinite(isArray(v) ? v[0] : v.x) && isFinite(isArray(v) ? v[1] : v.y)) via.push(isArray(v) ? [+v[0], +v[1]] : [+v.x, +v.y]);
      }
    }
    if (isArray(opts.obstacles) && !via.length) {
      for (i = 0; i < opts.obstacles.length; i++) {
        var o = opts.obstacles[i];
        if (!o || !(o.w > 0) || !(o.h > 0)) continue;
        // what touches an end box (or is one) cannot be gone round
        if (overlap(o, A.rect, A.pt) || overlap(o, B.rect, B.pt)) continue;
        obst.push({ x: +o.x, y: +o.y, w: +o.w, h: +o.h });
      }
    }
    var res = via.length ? viaRoute(A, B, fs, ts, via) : plainRoute(A, B, fs, ts, obst);
    var pts = res.pts, n = pts.length;
    if (opts.lane && !via.length && !A.pt && !B.pt && n > 1) pts = laneShift(pts, num(opts.lane), A, res.fa, B, res.fb);
    var d0 = n > 1 ? legDir(pts[0], pts[1]) : -1, d1 = n > 1 ? legDir(pts[n - 2], pts[n - 1]) : -1;
    var fromSide = A.pt ? DIR_SIDE[d0 < 0 ? res.fa : d0] : DIR_SIDE[res.fa];
    var toSide = B.pt ? DIR_SIDE[d1 < 0 ? res.fb : (d1 + 2) % 4] : DIR_SIDE[res.fb];
    // ends meet the real outline of a shape that does not fill its box
    if (n > 1) {
      var e;
      if (A.kind && A.kind !== 'rect' && A.kind !== 'rounded' && A.rect.w > 0 && A.rect.h > 0) {
        e = shapeEdge(A.kind, A.rect.w, A.rect.h, fromSide, res.fa === 0 || res.fa === 2 ? pts[0][1] - A.rect.y : pts[0][0] - A.rect.x);
        pts[0] = [r2(A.rect.x + e.x), r2(A.rect.y + e.y)];
      }
      if (B.kind && B.kind !== 'rect' && B.kind !== 'rounded' && B.rect.w > 0 && B.rect.h > 0) {
        e = shapeEdge(B.kind, B.rect.w, B.rect.h, toSide, res.fb === 0 || res.fb === 2 ? pts[n - 1][1] - B.rect.y : pts[n - 1][0] - B.rect.x);
        pts[n - 1] = [r2(B.rect.x + e.x), r2(B.rect.y + e.y)];
      }
    }
    return finish(pts, r, fromSide, toSide);
  }

  // A route from its points: the drawn path, the middle, where a label sits, the length.
  function finish(pts, r, fromSide, toSide) {
    var n = pts.length, i, len = 0, legs = [], best = -1;
    for (i = 0; i + 1 < n; i++) {
      var l = Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]);
      legs.push(l); len += l;
    }
    var mid = { x: pts[0][0], y: pts[0][1] }, run = 0;
    for (i = 0; i < legs.length; i++) {
      if (run + legs[i] >= len / 2) {
        var t = legs[i] > 0 ? (len / 2 - run) / legs[i] : 0;
        mid = { x: r2(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t), y: r2(pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t) };
        break;
      }
      run += legs[i];
    }
    // the longest leg; of equals, the one nearest the middle of the path
    var bestD = Infinity;
    for (i = 0; i < legs.length; i++) {
      var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      var dm = Math.abs(mx - mid.x) + Math.abs(my - mid.y);
      if (best < 0 || legs[i] > legs[best] + 0.01 || (Math.abs(legs[i] - legs[best]) <= 0.01 && dm < bestD - 0.01)) { best = i; bestD = dm; }
    }
    var labelAt = best < 0 ? { x: mid.x, y: mid.y } :
      { x: r2((pts[best][0] + pts[best + 1][0]) / 2), y: r2((pts[best][1] + pts[best + 1][1]) / 2) };
    return { pts: pts, d: roundedPath(pts, r), fromSide: fromSide, toSide: toSide, labelAt: labelAt, mid: mid, len: r2(len), bends: Math.max(0, n - 2) };
  }

  // A route moved onto its own lane: every leg o to its left (as it travels), the corners where the
  // moved legs meet, the ends slid along the sides they sit on. Two routes on lanes o and o' run
  // |o - o'| apart all along, like tracks round a bend. Kept on the sides; when a leg would turn
  // round (a short jog), half the offset, else none.
  function laneShift(pts, o, A, fa, B, fb) {
    function room(E, d) { return Math.max(0, ((d === 0 || d === 2) ? E.rect.h : E.rect.w) / 2 - 6); }
    var cap = Math.min(room(A, fa), room(B, fb));
    o = Math.max(-cap, Math.min(cap, o));
    var tries = [o, o / 2];
    for (var t = 0; t < tries.length; t++) {
      var q = tries[t] ? offsetPts(pts, tries[t]) : null;
      if (q) return q;
    }
    return pts;
  }
  function sgn(v) { return v > 0.01 ? 1 : v < -0.01 ? -1 : 0; }
  function offsetPts(pts, o) {
    var n = pts.length, legs = [], out = [], i;
    for (i = 0; i + 1 < n; i++) {
      var dx = sgn(pts[i + 1][0] - pts[i][0]), dy = sgn(pts[i + 1][1] - pts[i][1]);
      if ((dx && dy) || (!dx && !dy)) return null;
      legs.push(dy === 0 ? { h: true, c: pts[i][1] - o * dx } : { h: false, c: pts[i][0] + o * dy });
    }
    out.push(legs[0].h ? [pts[0][0], legs[0].c] : [legs[0].c, pts[0][1]]);
    for (i = 1; i < legs.length; i++) {
      if (legs[i].h === legs[i - 1].h) return null;
      out.push(legs[i].h ? [legs[i - 1].c, legs[i].c] : [legs[i].c, legs[i - 1].c]);
    }
    var e = legs[legs.length - 1];
    out.push(e.h ? [pts[n - 1][0], e.c] : [e.c, pts[n - 1][1]]);
    for (i = 0; i + 1 < n; i++) {   // every leg still runs its own way, at least 2 px (or as long as it was)
      var ox = pts[i + 1][0] - pts[i][0], oy = pts[i + 1][1] - pts[i][1], nx = out[i + 1][0] - out[i][0], ny = out[i + 1][1] - out[i][1];
      if (sgn(nx) !== sgn(ox) || sgn(ny) !== sgn(oy) || Math.abs(nx) + Math.abs(ny) < Math.min(2, Math.abs(ox) + Math.abs(oy))) return null;
    }
    return out.map(function (p) { return [r2(p[0]), r2(p[1])]; });
  }

  // Arrows that join the same two items (either way, with no waypoints): each on its own lane, LANE
  // apart in array order (taken from the item whose id sorts first; an arrow the other way gets its
  // offset negated, as it travels the other way). -> {arrow id: lane offset} for those that share.
  var LANE = 12;
  function lanes(items) {
    var by = {}, keys = [], out = {}, i, j;
    for (i = 0; i < (items ? items.length : 0); i++) {
      var a = items[i];
      if (!a || a.type !== 'arrow' || typeof a.from !== 'string' || typeof a.to !== 'string' || a.from === a.to) continue;
      if (isArray(a.via) && a.via.length) continue;
      var k = a.from < a.to ? a.from + '\n' + a.to : a.to + '\n' + a.from;
      if (!by[k]) { by[k] = []; keys.push(k); }
      by[k].push([a.id, a.from < a.to ? 1 : -1]);
    }
    for (i = 0; i < keys.length; i++) {
      var ids = by[keys[i]], n = ids.length;
      if (n < 2) continue;
      var gap = Math.min(LANE, 36 / (n - 1));   // many arrows: closer lanes, all within ±18
      for (j = 0; j < n; j++) out[ids[j][0]] = r2((j - (n - 1) / 2) * gap * ids[j][1]) || 0;
    }
    return out;
  }

  // Arrows that meet one side of an item coming from (or going to) DIFFERENT places: each its own
  // point on that side, spread SLOT apart (closer on a short side) in the order of where their other
  // ends lie along that side, so they leave side by side and never cross there. Arrows to the same
  // place share a slot (geo.lanes keeps those apart). The side is the one the route takes with no
  // obstacles (or the one set). -> {arrow id: {from?: offset, to?: offset}} along the side from its
  // middle, for route's fromAt / toAt.
  var SLOT = 20;
  function slots(items, itemsById) {
    var get = lookup(itemsById || items), groups = {}, keys = [], out = {}, i, j;
    for (i = 0; i < (items ? items.length : 0); i++) {
      var a = items[i];
      if (!a || a.type !== 'arrow' || (isArray(a.via) && a.via.length) || (typeof a.from === 'string' && a.from === a.to)) continue;
      var ends = [a.from, a.to].map(function (v) {
        if (isArray(v)) return isFinite(v[0]) && isFinite(v[1]) ? { pt: [+v[0], +v[1]], key: 'p' + v[0] + ',' + v[1] } : null;
        var it = typeof v === 'string' ? get(v) : null;
        return it && it.type !== 'arrow' ? { rect: bounds(it, get, 1), key: 'i' + v, id: v } : null;
      });
      if (!ends[0] || !ends[1] || (!ends[0].id && !ends[1].id)) continue;
      var A = endOf(ends[0]), B = endOf(ends[1]);
      var fs = A.pt || !(a.fromSide in SIDE_DIR) ? null : SIDE_DIR[a.fromSide], ts = B.pt || !(a.toSide in SIDE_DIR) ? null : SIDE_DIR[a.toSide];
      var res = plainRoute(A, B, fs, ts, []);
      [[0, res.fa], [1, res.fb]].forEach(function (e) {
        var me = ends[e[0]], other = ends[1 - e[0]], E = e[0] ? B : A, O = e[0] ? A : B;
        if (!me.id) return;
        var hz = e[1] === 0 || e[1] === 2, k = me.id + '\n' + e[1];
        if (!groups[k]) { groups[k] = { side: e[1], len: hz ? E.rect.h : E.rect.w, list: [] }; keys.push(k); }
        groups[k].list.push({ id: a.id, end: e[0] ? 'to' : 'from', other: other.key,
          pos: hz ? O.rect.y + O.rect.h / 2 : O.rect.x + O.rect.w / 2 });
      });
    }
    for (i = 0; i < keys.length; i++) {
      var g = groups[keys[i]], bund = {}, order = [];
      g.list.forEach(function (x) {
        if (!bund[x.other]) { bund[x.other] = { pos: x.pos, key: x.other, ends: [] }; order.push(bund[x.other]); }
        bund[x.other].ends.push(x);
      });
      var n = order.length;
      if (n < 2) continue;
      order.sort(function (p, q) { return p.pos - q.pos || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0); });
      var gap = Math.min(SLOT, Math.max(0, g.len - 20) / (n - 1));
      for (j = 0; j < n; j++) {
        var off = r2((j - (n - 1) / 2) * gap) || 0;
        order[j].ends.forEach(function (x) { (out[x.id] = out[x.id] || {})[x.end] = off; });
      }
    }
    return out;
  }

  // Routes that run on top of each other for more than a stub (two arrows down one channel): their
  // middle legs moved apart, SEP between neighbours, in the order that keeps them from crossing where
  // they turn off (the one turning off first lies on the side it turns to). First and last legs stay
  // (they sit on their slots); a route marked fixed (waypoints set by hand) keeps all its legs.
  // list: [{id, pts, fixed?}] -> {id: moved pts} for the routes that moved.
  var SEP = 10;
  function separate(list) {
    var segs = [], buckets = {}, bkeys = [], out = {}, moved = {}, i, j;
    for (i = 0; i < list.length; i++) {
      var pts = list[i] && list[i].pts;
      if (!isArray(pts)) continue;
      for (j = 0; j + 1 < pts.length; j++) {
        var a = pts[j], b = pts[j + 1], h = Math.abs(a[1] - b[1]) < 0.01, v = Math.abs(a[0] - b[0]) < 0.01;
        if (h === v) continue;
        var s = { k: i, j: j, h: h, c: h ? a[1] : a[0], lo: Math.min(h ? a[0] : a[1], h ? b[0] : b[1]), hi: Math.max(h ? a[0] : a[1], h ? b[0] : b[1]),
          fixed: !!list[i].fixed || j === 0 || j + 2 === pts.length };
        var key = (h ? 'h' : 'v') + Math.round(s.c * 2);
        if (!buckets[key]) { buckets[key] = []; bkeys.push(key); }
        buckets[key].push(s);
        segs.push(s);
      }
    }
    function turn(pts, j, atLo, h) {  // where the route goes on from the leg's low (or high) end: -1 / +1 across it, 0 none
      var a = pts[j], b = pts[j + 1], endIsA = (h ? a[0] < b[0] : a[1] < b[1]) === atLo, q = endIsA ? pts[j - 1] : pts[j + 2], p = endIsA ? a : b;
      if (!q) return 0;
      var d = h ? q[1] - p[1] : q[0] - p[0];
      return d > 0.01 ? 1 : d < -0.01 ? -1 : 0;
    }
    for (i = 0; i < bkeys.length; i++) {
      var bk = buckets[bkeys[i]];
      if (bk.length < 2) continue;
      bk.sort(function (p, q) { return p.lo - q.lo || p.k - q.k; });
      // runs of legs of different routes that overlap by more than a stub
      var used = {};
      for (j = 0; j < bk.length; j++) {
        if (used[j]) continue;
        var comp = [bk[j]], seen = {}, hiEnd = bk[j].hi, m;
        seen[bk[j].k] = 1; used[j] = 1;
        for (m = j + 1; m < bk.length && bk[m].lo < hiEnd - STUB; m++) {
          if (used[m] || seen[bk[m].k]) continue;
          if (Math.min(hiEnd, bk[m].hi) - bk[m].lo <= STUB) continue;
          comp.push(bk[m]); seen[bk[m].k] = 1; used[m] = 1; hiEnd = Math.max(hiEnd, bk[m].hi);
        }
        if (comp.length < 2) continue;
        var mov = comp.filter(function (s) { return !s.fixed && !moved[s.k]; }), nFix = comp.length - mov.length;
        if (!mov.length || (nFix === 0 && mov.length < 2)) continue;
        mov.forEach(function (s) {
          var P = list[s.k].pts, tl = turn(P, s.j, true, s.h), th = turn(P, s.j, false, s.h);
          s.score = (th > 0 ? -s.hi : th < 0 ? s.hi : 0) + (tl > 0 ? s.lo : tl < 0 ? -s.lo : 0);
        });
        mov.sort(function (p, q) { return p.score - q.score || p.k - q.k; });
        var offs = [], gap = Math.min(SEP, 24 / Math.max(1, comp.length - 1));
        if (nFix) { for (var t = 1; offs.length < mov.length; t++) offs.push(-t * gap, t * gap); offs = offs.slice(0, mov.length).sort(function (p, q) { return p - q; }); }
        else for (t = 0; t < mov.length; t++) offs.push((t - (mov.length - 1) / 2) * gap);
        mov.forEach(function (s, x) {
          var P = list[s.k].pts, o = offs[x], q = P.map(function (p) { return [p[0], p[1]]; }), ax = s.h ? 1 : 0;
          q[s.j][ax] = r2(q[s.j][ax] + o); q[s.j + 1][ax] = r2(q[s.j + 1][ax] + o);
          // the legs either side only grow or shrink: each keeps its way and some length
          var okay = [s.j - 1, s.j + 1].every(function (w) {
            var d0 = P[w + 1][ax] - P[w][ax], d1 = q[w + 1][ax] - q[w][ax];
            return Math.abs(d1) >= 4 && (d0 > 0) === (d1 > 0);
          });
          if (!okay) return;
          list[s.k] = { id: list[s.k].id, pts: q, fixed: list[s.k].fixed };
          out[list[s.k].id] = q; moved[s.k] = 1;
        });
      }
    }
    return out;
  }
  // A route given other points (geo.separate): its path, middle and label place again.
  function withPts(rt, pts, r) { return finish(pts.map(function (p) { return [p[0], p[1]]; }), r == null ? 8 : r, rt && rt.fromSide, rt && rt.toSide); }

  function overlap(o, r, isPt) {
    if (isPt) return r.x >= o.x && r.x <= o.x + o.w && r.y >= o.y && r.y <= o.y + o.h;
    return o.x < r.x + r.w && o.x + o.w > r.x && o.y < r.y + r.h && o.y + o.h > r.y;
  }

  // The route of an arrow item: its ends looked up, shapes met at their outline.
  // lane: this arrow's offset from geo.lanes (absent: none).
  function arrowRoute(arrow, itemsById, obstacles, r, lane, slot) {
    if (!arrow) return null;
    var get = lookup(itemsById);
    function end(e) {
      if (isArray(e)) return isFinite(e[0]) && isFinite(e[1]) ? { pt: [+e[0], +e[1]] } : null;
      if (e == null) return null;
      var it = get(e);
      if (!it) return null;
      var b = bounds(it, get, 1);
      if (it.type === 'arrow') return null;
      return { rect: b, kind: it.type === 'box' ? it.kind || 'rounded' : 'rect' };
    }
    var a = end(arrow.from), b = end(arrow.to);
    if (!a || !b) return null;
    return route(a, b, { fromSide: arrow.fromSide, toSide: arrow.toSide, via: arrow.via, obstacles: obstacles, r: r, lane: lane,
      fromAt: slot && slot.from, toAt: slot && slot.to });
  }

  function vec(dir) {
    if (typeof dir === 'string' && dir in SIDE_DIR) return [-DX[SIDE_DIR[dir]], -DY[SIDE_DIR[dir]]];
    if (typeof dir === 'number') return [Math.cos(dir), Math.sin(dir)];
    var x = dir ? (isArray(dir) ? num(dir[0]) : num(dir.x)) : 1, y = dir ? (isArray(dir) ? num(dir[1]) : num(dir.y)) : 0;
    var l = Math.sqrt(x * x + y * y);
    return l > 0 ? [x / l, y / l] : [1, 0];
  }

  // dir: the side of the box the head sits at (route.toSide / route.fromSide), or the way the head
  // points as [dx, dy], {x, y} or radians.
  function headPath(kind, tip, dir, size) {
    var x = isArray(tip) ? num(tip[0]) : num(tip && tip.x), y = isArray(tip) ? num(tip[1]) : num(tip && tip.y);
    var v = vec(dir);
    if (kind === 'arrow') {
      var s = size > 0 ? size : 10, hw = s * 0.42, bx = x - v[0] * s, by = y - v[1] * s;
      return 'M' + fmt(x) + ' ' + fmt(y) + ' L' + fmt(bx - v[1] * hw) + ' ' + fmt(by + v[0] * hw) +
        ' L' + fmt(bx + v[1] * hw) + ' ' + fmt(by - v[0] * hw) + ' Z';
    }
    if (kind === 'circle') {
      var rad = (size > 0 ? size : 8) / 2, segs = ellipseSegs(x - v[0] * rad, y - v[1] * rad, rad, rad), out = [];
      for (var i = 0; i < segs.length; i++) out.push((i === 0 ? 'M' : 'C') + segs[i].map(fmt).join(' '));
      return out.join(' ') + ' Z';
    }
    return '';
  }

  // ---------- pen

  function penPath(points, x, y) {
    x = num(x); y = num(y);
    var P = [], i;
    for (i = 0; points && i + 1 < points.length; i += 2) P.push([num(points[i]) + x, num(points[i + 1]) + y]);
    if (!P.length) return '';
    var d = 'M' + fmt(P[0][0]) + ' ' + fmt(P[0][1]);
    if (P.length === 1) return d + ' L' + fmt(P[0][0]) + ' ' + fmt(P[0][1]);
    var runs = [], cur = [P[0]];
    for (i = 1; i < P.length; i++) {
      if (P[i][0] === P[i - 1][0] && P[i][1] === P[i - 1][1]) {
        if (cur.length > 1) { runs.push(cur); cur = [P[i]]; }
      } else cur.push(P[i]);
    }
    if (cur.length > 1) runs.push(cur);
    for (var k = 0; k < runs.length; k++) {
      var p = runs[k], n = p.length;
      if (n === 2) { d += ' L' + fmt(p[1][0]) + ' ' + fmt(p[1][1]); continue; }
      for (i = 0; i + 1 < n; i++) {
        var p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
        d += ' C' + fmt(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + fmt(p1[1] + (p2[1] - p0[1]) / 6) + ' ' +
          fmt(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + fmt(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + fmt(p2[0]) + ' ' + fmt(p2[1]);
      }
    }
    return d;
  }

  function simplify(points, tol) {
    var n = points ? points.length >> 1 : 0;
    if (n < 3) return points ? points.slice(0, n * 2) : [];
    tol = tol > 0 ? tol : 1;
    var keep = new Uint8Array(n), stack = [0, n - 1], out = [], i;
    keep[0] = keep[n - 1] = 1;
    while (stack.length) {
      var b = stack.pop(), a = stack.pop(), far = -1, max = tol;
      for (i = a + 1; i < b; i++) {
        var d = segDist(points[2 * i], points[2 * i + 1], points[2 * a], points[2 * a + 1], points[2 * b], points[2 * b + 1]);
        if (d > max) { max = d; far = i; }
      }
      if (far > 0) { keep[far] = 1; stack.push(a, far, far, b); }
    }
    for (i = 0; i < n; i++) if (keep[i]) out.push(points[2 * i], points[2 * i + 1]);
    return out;
  }

  // ---------- hit tests

  function segDist(px0, py0, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px0 - ax) * dx + (py0 - ay) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var ex = px0 - ax - t * dx, ey = py0 - ay - t * dy;
    return Math.sqrt(ex * ex + ey * ey);
  }
  function polyDist(pts, x, y, closed) {
    var best = Infinity;
    if (pts.length === 1) return segDist(x, y, pts[0][0], pts[0][1], pts[0][0], pts[0][1]);
    for (var i = 0; i + 1 < pts.length; i++) best = Math.min(best, segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
    if (closed && pts.length > 2) best = Math.min(best, segDist(x, y, pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]));
    return best;
  }
  // A segment against a rect (touching counts).
  function segRect(ax, ay, bx, by, x1, y1, x2, y2) {
    var t0 = 0, t1 = 1, dx = bx - ax, dy = by - ay, p = [-dx, dx, -dy, dy], q = [ax - x1, x2 - ax, ay - y1, y2 - ay];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      var t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }
  function penPts(item) {
    var o = [], p = item.points || [], x = num(item.x), y = num(item.y);
    for (var i = 0; i + 1 < p.length; i += 2) o.push([p[i] + x, p[i + 1] + y]);
    return o;
  }

  function hit(item, x, y, tol, itemsById) {
    if (!item) return false;
    tol = tol >= 0 ? tol : 4;
    var t = item.type, pts;
    if (t === 'arrow') {
      var rt = arrowRoute(item, itemsById);
      return !!rt && polyDist(rt.pts, x, y) <= tol;
    }
    if (t === 'pen') {
      pts = penPts(item);
      return pts.length > 0 && polyDist(pts, x, y) <= tol + (item.width > 0 ? item.width : 3) / 2;
    }
    var b = bounds(item, itemsById);
    if (t === 'section' && item.text && y < b.y && y >= b.y - 26 - tol && x >= b.x - tol &&
        x <= b.x + Math.min(b.w, measure(item.text, SIZES.small, 0, true).w + 8) + tol) return true;
    if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) return false;
    var kind = t === 'box' ? item.kind || 'rounded' : 'rect';
    if (kind === 'rect' || kind === 'rounded' || kind === 'database' || kind === 'queue' || kind === 'document') return true;
    var polys = shapePoly(kind, b.w, b.h), lx = x - b.x, ly = y - b.y;
    for (var i = 0; i < polys.length; i++) {
      if (inPoly(polys[i], lx, ly) || polyDist(polys[i], lx, ly, true) <= tol) return true;
    }
    return false;
  }

  function inRect(item, rect, whole, itemsById) {
    if (!item || !rect) return false;
    var x1 = Math.min(rect.x, rect.x + rect.w), x2 = Math.max(rect.x, rect.x + rect.w);
    var y1 = Math.min(rect.y, rect.y + rect.h), y2 = Math.max(rect.y, rect.y + rect.h);
    var b = bounds(item, itemsById), pts = null;
    if (item.type === 'arrow') {
      var rt = arrowRoute(item, itemsById);
      if (!rt) return false;
      pts = rt.pts;
    }
    if (whole) return b.x >= x1 && b.y >= y1 && b.x + b.w <= x2 && b.y + b.h <= y2;
    if (item.type === 'pen') pts = penPts(item);
    if (pts) {
      if (pts.length === 1) return pts[0][0] >= x1 && pts[0][0] <= x2 && pts[0][1] >= y1 && pts[0][1] <= y2;
      for (var i = 0; i + 1 < pts.length; i++) if (segRect(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], x1, y1, x2, y2)) return true;
      return false;
    }
    return b.x <= x2 && b.x + b.w >= x1 && b.y <= y2 && b.y + b.h >= y1;
  }

  function contains(o, i) { return i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h; }
  function centreIn(b, s) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h;
  }

  function members(section, items) {
    var out = [], get = lookup(items), sb = bounds(section, get);
    for (var i = 0; i < (items ? items.length : 0); i++) {
      var it = items[i];
      if (!it || it === section || (it.id != null && it.id === section.id)) continue;
      var b = bounds(it, get);
      if (it.type === 'arrow' && !b.w && !b.h && !arrowRoute(it, get)) continue;
      if (!centreIn(b, sb)) continue;
      if (it.type === 'section' && contains(b, sb)) continue; // a frame around this one
      out.push(it);
    }
    return out;
  }

  // ---------- arranging

  function snap(m, others, tol) {
    tol = tol >= 0 ? tol : 6;
    var mx = [m.x, m.x + m.w / 2, m.x + m.w], my = [m.y, m.y + m.h / 2, m.y + m.h];
    var bx = null, by = null, sx = Infinity, sy = Infinity, i, a, b, d, s, o;
    function lines(r, horiz) { return horiz ? [r.y, r.y + r.h / 2, r.y + r.h] : [r.x, r.x + r.w / 2, r.x + r.w]; }
    for (i = 0; i < (others ? others.length : 0); i++) {
      o = others[i];
      if (!o) continue;
      var ox = lines(o, false), oy = lines(o, true);
      for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) {
        var mixed = (a === 1) !== (b === 1) ? 0.25 : 0; // a centre against an edge is the last choice
        d = ox[b] - mx[a]; s = Math.abs(d) + mixed;
        if (Math.abs(d) <= tol && s < sx - 1e-9) { sx = s; bx = d; }
        d = oy[b] - my[a]; s = Math.abs(d) + mixed;
        if (Math.abs(d) <= tol && s < sy - 1e-9) { sy = s; by = d; }
      }
    }
    var dx = bx === null ? 0 : bx, dy = by === null ? 0 : by, gv = {}, gh = {}, guides = [], key;
    for (i = 0; i < (others ? others.length : 0); i++) {
      o = others[i];
      if (!o) continue;
      var ex = lines(o, false), ey = lines(o, true);
      for (a = 0; a < 3; a++) for (b = 0; b < 3; b++) {
        if (bx !== null && Math.abs(ex[b] - mx[a] - bx) < 0.01) {
          key = r2(ex[b]);
          if (!gv[key]) { gv[key] = { x1: ex[b], y1: m.y + dy, x2: ex[b], y2: m.y + dy + m.h }; guides.push(gv[key]); }
          gv[key].y1 = Math.min(gv[key].y1, o.y); gv[key].y2 = Math.max(gv[key].y2, o.y + o.h);
        }
        if (by !== null && Math.abs(ey[b] - my[a] - by) < 0.01) {
          key = r2(ey[b]);
          if (!gh[key]) { gh[key] = { x1: m.x + dx, y1: ey[b], x2: m.x + dx + m.w, y2: ey[b] }; guides.push(gh[key]); }
          gh[key].x1 = Math.min(gh[key].x1, o.x); gh[key].x2 = Math.max(gh[key].x2, o.x + o.w);
        }
      }
    }
    return { dx: dx, dy: dy, guides: guides };
  }

  function align(rects, how) {
    var n = rects ? rects.length : 0, out = [], i;
    if (!n) return out;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (i = 0; i < n; i++) {
      var r = rects[i];
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
      out.push({ id: r.id, x: r.x, y: r.y });
    }
    if (how === 'left') for (i = 0; i < n; i++) out[i].x = x0;
    else if (how === 'right') for (i = 0; i < n; i++) out[i].x = x1 - rects[i].w;
    else if (how === 'center') for (i = 0; i < n; i++) out[i].x = (x0 + x1) / 2 - rects[i].w / 2;
    else if (how === 'top') for (i = 0; i < n; i++) out[i].y = y0;
    else if (how === 'bottom') for (i = 0; i < n; i++) out[i].y = y1 - rects[i].h;
    else if (how === 'middle') for (i = 0; i < n; i++) out[i].y = (y0 + y1) / 2 - rects[i].h / 2;
    else if ((how === 'hspace' || how === 'vspace') && n > 2) {
      var h = how === 'hspace', idx = [], total = 0;
      for (i = 0; i < n; i++) { idx.push(i); total += h ? rects[i].w : rects[i].h; }
      idx.sort(function (p, q) {
        var d = h ? rects[p].x + rects[p].w / 2 - rects[q].x - rects[q].w / 2 : rects[p].y + rects[p].h / 2 - rects[q].y - rects[q].h / 2;
        return d || p - q;
      });
      var gap = ((h ? x1 - x0 : y1 - y0) - total) / (n - 1), at0 = h ? x0 : y0;
      for (i = 0; i < n; i++) {
        var k = idx[i];
        if (h) { out[k].x = r2(at0); at0 += rects[k].w + gap; } else { out[k].y = r2(at0); at0 += rects[k].h + gap; }
      }
    }
    return out;
  }

  // x, y: the board point at the view's top-left (screen = (board - x) * zoom); tx, ty: the same as
  // a translate (screen = board * zoom + tx). Zooms out as far as needed, in to maxZoom (1).
  function fit(rects, viewW, viewH, pad, maxZoom) {
    pad = pad >= 0 ? pad : 40;
    maxZoom = maxZoom > 0 ? maxZoom : 1;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
    for (i = 0; i < (rects ? rects.length : 0); i++) {
      var r = rects[i];
      if (!r) continue;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + (r.w || 0)); y1 = Math.max(y1, r.y + (r.h || 0));
    }
    if (x0 === Infinity) { x0 = y0 = x1 = y1 = 0; }
    var bw = x1 - x0, bh = y1 - y0;
    var zoom = Math.min(bw > 0 ? Math.max(1, viewW - 2 * pad) / bw : maxZoom, bh > 0 ? Math.max(1, viewH - 2 * pad) / bh : maxZoom, maxZoom);
    zoom = Math.max(0.02, zoom);
    var x = x0 - (viewW / zoom - bw) / 2, y = y0 - (viewH / zoom - bh) / 2;
    return { zoom: zoom, x: x, y: y, tx: -x * zoom, ty: -y * zoom };
  }

  // What reads badly: blocks covering each other, a block sticking out of the section it sits
  // in, a block tight against that section's edge. Worst first, at most 20.
  function issues(items) {
    var get = lookup(items), list = [], secs = [], out = [], i, j;
    for (i = 0; i < (items ? items.length : 0); i++) {
      var it = items[i];
      if (!it || it.type === 'arrow' || it.type === 'pen') continue;
      var e = { it: it, b: bounds(it, get) };
      list.push(e);
      if (it.type === 'section') secs.push(e);
    }
    for (i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.it.type !== 'section') {
        for (j = i + 1; j < list.length; j++) {
          var q = list[j];
          if (q.it.type === 'section' || (p.it.group && p.it.group === q.it.group)) continue;
          var ow = Math.min(p.b.x + p.b.w, q.b.x + q.b.w) - Math.max(p.b.x, q.b.x);
          var oh = Math.min(p.b.y + p.b.h, q.b.y + q.b.h) - Math.max(p.b.y, q.b.y);
          if (ow > 4 && oh > 4) out.push({ kind: 'overlap', ids: [p.it.id, q.it.id], rank: 0, score: ow * oh });
        }
      }
      var home = null;
      for (j = 0; j < secs.length; j++) {
        var s = secs[j];
        if (s === p || !centreIn(p.b, s.b)) continue;
        if (p.it.type === 'section' && (contains(p.b, s.b) || p.b.w * p.b.h >= s.b.w * s.b.h)) continue;
        if (!home || s.b.w * s.b.h < home.b.w * home.b.h) home = s;
      }
      if (!home) continue;
      var h = home.b, b = p.b;
      var margin = Math.min(b.x - h.x, b.y - h.y, h.x + h.w - b.x - b.w, h.y + h.h - b.y - b.h);
      if (margin < -0.5) {
        var iw = Math.min(b.x + b.w, h.x + h.w) - Math.max(b.x, h.x), ih = Math.min(b.y + b.h, h.y + h.h) - Math.max(b.y, h.y);
        out.push({ kind: 'outside', ids: [p.it.id, home.it.id], rank: 0, score: b.w * b.h - Math.max(0, iw) * Math.max(0, ih) });
      } else if (margin < 8) out.push({ kind: 'tight', ids: [p.it.id, home.it.id], rank: 1, score: 8 - margin });
    }
    for (i = 0; i < out.length; i++) out[i].n = i;
    out.sort(function (a, b) { return a.rank - b.rank || b.score - a.score || a.n - b.n; });
    return out.slice(0, 20).map(function (o) { return { kind: o.kind, ids: o.ids }; });
  }

  var api = {
    SIZES: SIZES,
    KINDS: KINDS,
    measure: measure,
    richLines: richLines,
    stripMarks: stripMarks,
    shapePath: shapePath,
    shapeInset: shapeInset,
    shapePoly: shapePoly,
    shapeEdge: shapeEdge,
    bounds: bounds,
    tableLayout: tableLayout,
    anchor: anchor,
    route: route,
    arrowRoute: arrowRoute,
    lanes: lanes,
    slots: slots,
    separate: separate,
    withPts: withPts,
    headPath: headPath,
    penPath: penPath,
    simplify: simplify,
    hit: hit,
    inRect: inRect,
    members: members,
    snap: snap,
    align: align,
    fit: fit,
    issues: issues
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.boardGeo = api;
  else if (root) root.boardGeo = api;
})(this);
