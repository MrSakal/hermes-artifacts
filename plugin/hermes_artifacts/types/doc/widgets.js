/* Code blocks the doc shows as pictures: ```latex (a formula), ```csv (a grid), ```chart (a chart drawn
 * from rows), ```svg (a drawing). Each keeps its source: "Source" opens it, and the block's Markdown is
 * that source, so Hermes and the exports read it as text. window.docWidgets. */
(function () {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var KINDS = { latex: 1, math: 1, tex: 1, csv: 1, chart: 1, svg: 1 };

  // ---------------------------------------------------------------- csv
  function csvRows(text) {
    var rows = [], row = [], cur = "", q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
      if (c === '"') q = true;
      else if (c === "," || c === ";" && !/,/.test(text)) { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c !== "\r") cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }
  function csvHtml(text) {
    var rows = csvRows(text).slice(0, 500);
    if (!rows.length) return '<div class="w-empty">CSV</div>';
    var num = function (s) { return /^-?[\d\s.,]+%?$/.test(s.trim()); };
    return '<div class="w-csv"><table><thead><tr>' + rows[0].map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.slice(1).map(function (r) {
        return "<tr>" + rows[0].map(function (_, k) { var v = r[k] || ""; return "<td" + (num(v) ? ' class="num"' : "") + ">" + esc(v) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  // ---------------------------------------------------------------- chart
  // {"type":"bar"|"line"|"area", "title":"W4 was the strongest week", "x":"week", "y":"orders" | ["a","b"],
  //  "unit":"pcs", "highlight":"W4", "data":[{"week":"W1","orders":240}, …], "source":"…"}
  function chartHtml(text) {
    var spec;
    try { spec = JSON.parse(text); } catch (e) { return '<div class="w-error">chart: ' + esc(e.message) + "</div>"; }
    var rows = Array.isArray(spec.data) ? spec.data.slice(0, 400) : [];
    if (!rows.length) return '<div class="w-error">chart: no data</div>';
    var xk = spec.x || Object.keys(rows[0])[0];
    var ys = [].concat(spec.y || Object.keys(rows[0]).filter(function (k) { return k !== xk && typeof rows[0][k] === "number"; })[0] || []);
    var type = spec.type === "line" || spec.type === "area" ? spec.type : "bar";
    var W = 760, H = 320, L = 52, R = 24, T = spec.title ? 56 : 24, B = 40;
    var val = function (r, k) { var v = r[k]; return v == null || v === "" ? NaN : Number(v); }; // an empty cell is no point, not a zero
    var vals = []; rows.forEach(function (r) { ys.forEach(function (y) { var v = val(r, y); if (isFinite(v)) vals.push(v); }); });
    var max = Math.max(0, Math.max.apply(null, vals)), min = Math.min(0, Math.min.apply(null, vals));
    if (max === min) max = min + 1;
    var step = Math.pow(10, Math.floor(Math.log10((max - min) / 4))), nice = [1, 2, 2.5, 5, 10].map(function (k) { return k * step; })
      .find(function (s) { return (max - min) / s <= 5; }) || step;
    max = Math.ceil(max / nice) * nice; min = Math.floor(min / nice) * nice;
    var y = function (v) { return T + (H - T - B) * (1 - (v - min) / (max - min)); };
    var band = (W - L - R) / rows.length, x = function (i) { return L + band * i + band / 2; };
    var fmt = function (v) { return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }); };
    var hi = spec.highlight == null ? null : String(spec.highlight);
    var color = function (k, r) { return ys.length > 1 ? "var(--w-c" + (k % 6 + 1) + ")" : hi == null || String(r[xk]) === hi ? "var(--w-c1)" : "var(--w-muted)"; };
    var out = '<svg class="w-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(spec.title || "chart") + '">';
    if (spec.title) out += '<text x="' + L + '" y="28" class="w-title">' + esc(spec.title) + "</text>";
    for (var g = min; g <= max + 1e-9; g += nice) {
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(g) + '" y2="' + y(g) + '" class="' + (g === 0 ? "w-axis" : "w-grid") + '"/>' +
        '<text x="' + (L - 8) + '" y="' + (y(g) + 4) + '" text-anchor="end" class="w-tick">' + fmt(g) + "</text>";
    }
    var every = Math.ceil(rows.length / 12);
    rows.forEach(function (r, i) {
      if (i % every === 0) out += '<text x="' + x(i) + '" y="' + (H - B + 18) + '" text-anchor="middle" class="w-tick">' + esc(r[xk]) + "</text>";
    });
    if (type === "bar") {
      var bw = Math.min(56, band * 0.7 / ys.length);
      rows.forEach(function (r, i) {
        ys.forEach(function (k, j) {
          var v = val(r, k); if (!isFinite(v)) return;
          var bx = x(i) - bw * ys.length / 2 + bw * j, top = y(Math.max(v, 0)), hgt = Math.abs(y(v) - y(0));
          out += '<rect x="' + bx + '" y="' + top + '" width="' + (bw - 2) + '" height="' + Math.max(1, hgt) + '" rx="3" fill="' + color(j, r) + '"><title>' +
            esc(r[xk] + (ys.length > 1 ? " · " + k : "") + ": " + fmt(v) + (spec.unit ? " " + spec.unit : "")) + "</title></rect>";
          if (rows.length * ys.length <= 16) out += '<text x="' + (bx + bw / 2 - 1) + '" y="' + (top - 6) + '" text-anchor="middle" class="w-val">' + fmt(v) + "</text>";
        });
      });
    } else {
      ys.forEach(function (k, j) {
        var pts = rows.map(function (r, i) { var v = val(r, k); return isFinite(v) ? [x(i), y(v)] : null; });
        var seen = pts.filter(Boolean);
        if (!seen.length) return;
        var d = "", pen = false;
        pts.forEach(function (p) { if (!p) { pen = false; return; } d += (pen ? "L" : "M") + p[0] + " " + p[1]; pen = true; });
        if (type === "area") out += '<path d="' + seen.map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join("") + "L" + seen[seen.length - 1][0] + " " + y(0) + "L" + seen[0][0] + " " + y(0) + 'Z" fill="var(--w-c' + (j % 6 + 1) + ')" fill-opacity=".15"/>';
        out += '<path d="' + d + '" fill="none" stroke="var(--w-c' + (j % 6 + 1) + ')" stroke-width="2"/>';
        rows.forEach(function (r, i) {
          if (!pts[i]) return;
          out += '<circle cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="' + (hi != null && String(r[xk]) === hi ? 5 : 3) + '" fill="var(--w-c' + (j % 6 + 1) + ')"><title>' +
            esc(r[xk] + (ys.length > 1 ? " · " + k : "") + ": " + fmt(r[k]) + (spec.unit ? " " + spec.unit : "")) + "</title></circle>";
        });
      });
    }
    if (ys.length > 1) ys.forEach(function (k, j) { // the legend, for bars and lines alike
        out += '<rect x="' + (W - R - 120) + '" y="' + (T - 18 + j * 16) + '" width="10" height="10" rx="2" fill="var(--w-c' + (j % 6 + 1) + ')"/><text x="' + (W - R - 104) + '" y="' + (T - 9 + j * 16) + '" class="w-tick">' + esc(k) + "</text>";
      });
    out += "</svg>";
    return '<figure class="w-fig">' + out + (spec.source ? "<figcaption>" + esc(spec.source) + "</figcaption>" : "") + "</figure>";
  }

  // ---------------------------------------------------------------- svg (a drawing; no scripts, no links out)
  function svgHtml(text) {
    var doc = new DOMParser().parseFromString(text, "image/svg+xml"), root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return '<div class="w-error">svg: not a drawing</div>';
    (function clean(n) {
      Array.prototype.slice.call(n.children).forEach(function (c) {
        if (/^(script|foreignObject|iframe|object|embed|use|image)$/i.test(c.nodeName)) { c.remove(); return; }
        Array.prototype.slice.call(c.attributes).forEach(function (a) {
          if (/^on/i.test(a.name) || /^(href|xlink:href)$/i.test(a.name) && !/^#/.test(a.value) || /javascript:|url\((?!#)/i.test(a.value)) c.removeAttribute(a.name);
        });
        clean(c);
      });
    })(root);
    Array.prototype.slice.call(root.attributes).forEach(function (a) { if (/^on/i.test(a.name)) root.removeAttribute(a.name); });
    root.setAttribute("class", "w-svg");
    return '<figure class="w-fig">' + new XMLSerializer().serializeToString(root) + "</figure>";
  }

  // ---------------------------------------------------------------- latex (KaTeX, loaded on first use, MathML out)
  var katex = null, waiting = [];
  function latexHtml(text, load) {
    if (katex) {
      try { return '<div class="w-math">' + katex.renderToString(text, { displayMode: true, output: "mathml", throwOnError: false }) + "</div>"; }
      catch (e) { return '<div class="w-error">' + esc(e.message) + "</div>"; }
    }
    if (load) load();
    return '<div class="w-math w-wait"><code>' + esc(text) + "</code></div>";
  }
  function loadKatex(vendor, redraw) {
    if (katex || !vendor) return;
    if (waiting.push(redraw) > 1) return;
    vendor("katex.min.js").then(function (src) {
      (0, eval)(src + "\n//# sourceURL=vendor/katex.min.js");
      katex = window.katex || null;
      var w = waiting; waiting = [];
      w.forEach(function (f) { try { f(); } catch (_) {} });
    }).catch(function () { waiting = []; });
  }

  function html(lang, text, opt) {
    lang = String(lang || "").toLowerCase();
    if (!KINDS[lang]) return null;
    var body = lang === "csv" ? csvHtml(text) : lang === "chart" ? chartHtml(text) : lang === "svg" ? svgHtml(text)
      : latexHtml(text, opt && opt.vendor ? function () { loadKatex(opt.vendor, opt.redraw); } : null);
    if (opt && opt.bare) return body; // exports: the picture alone
    var label = { latex: "Formula", math: "Formula", tex: "Formula", csv: "CSV", chart: "Chart", svg: "Drawing" }[lang];
    var edit = opt && opt.editLabel && (lang === "chart" || lang === "csv") ? '<button type="button" class="w-edit" data-ui>' + esc(opt.editLabel) + "</button>" : "";
    return '<div class="w-box" data-widget="' + lang + '"><div class="w-head" data-ui>' + edit + '<button type="button" class="w-src" data-ui>' +
      esc(opt && opt.sourceLabel || "Source") + '</button><span class="w-kind">' + esc(opt && opt.labels && opt.labels[lang] || label) + "</span></div>" + body + "</div>";
  }

  window.docWidgets = { html: html, kinds: KINDS, csvRows: csvRows, ready: function () { return !!katex; } };
})();
