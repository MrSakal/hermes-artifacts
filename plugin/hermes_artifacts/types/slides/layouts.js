/* hermes-artifacts slide layouts: a slide described as data in deck.json, drawn by code, so the agent
 * writes content instead of the same 1920x1080 HTML every time.
 *
 *   "theme":  {"mode": "dark" | "light", "accent": "#2dd4bf", "bg": …, "fg": …, "muted": …, "surface": …,
 *              "font": "…", "headingFont": "…"}
 *   "slides": [{"id": "cover", "layout": "title", "title": "Q3 review", "subtitle": "…", "kicker": "…"}, …]
 *
 * Layouts: title, section, bullets, kpis, table, two-col, quote, image, chart, closing, blank. Text fields
 * take **bold** and *italic*. Every slide can carry "notes" and "transition" (fade | push | magic); "build": true
 * brings bullets / cards in one click at a time while presenting. window.slideLayout(def, theme) -> HTML.
 */
(function () {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function rich(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
  }
  function safeColor(c, fb) {
    return /^#[0-9a-f]{3,8}$/i.test(c || "") || /^rgba?\([\d\s.,%]+\)$/i.test(c || "") || /^color\(srgb[\d\s.,\/-]+\)$/i.test(c || "") ? c : fb;
  }
  function safeFont(f, fb) { return /^[\w\s,"'.-]{1,400}$/.test(f || "") ? f.replace(/"/g, "'") : fb; }

  function themeOf(t) {
    t = t || {};
    var dark = t.mode !== "light";
    return {
      dark: dark,
      bg: safeColor(t.bg, dark ? "#0e131a" : "#f7f9fc"),
      bg2: safeColor(t.bg2, dark ? "#111a24" : "#eef3f8"),
      surface: safeColor(t.surface, dark ? "#16202c" : "#ffffff"),
      line: safeColor(t.line, dark ? "#263445" : "#dde4ee"),
      fg: safeColor(t.fg, dark ? "#e8eef6" : "#0f1720"),
      muted: safeColor(t.muted, dark ? "#93a3b8" : "#5b6b80"),
      accent: safeColor(t.accent, dark ? "#2dd4bf" : "#0d9488"),
      accent2: safeColor(t.accent2, dark ? "#818cf8" : "#4f46e5"),
      font: safeFont(t.font, "'Inter', 'Segoe UI', Arial, sans-serif"),
      head: safeFont(t.headingFont, "'Inter Tight', 'Inter', 'Segoe UI', Arial, sans-serif")
    };
  }

  function section(def, th, inner, extra) {
    var tr = /^(fade|push|magic)$/.test(def.transition || "") ? ' data-transition="' + def.transition + '"' : "";
    var bg = extra && extra.bg ? extra.bg : th.bg;
    return '<section id="' + esc(def.id) + '"' + tr + ' style="background:' + bg + ";color:" + th.fg + ";font-family:" + th.font +
      ";padding:120px 128px;display:flex;flex-direction:column;gap:44px" + (extra && extra.style ? ";" + extra.style : "") + '">' +
      inner + (def.notes ? "<aside>" + esc(def.notes) + "</aside>" : "") + "</section>";
  }
  function heading(def, th, size) {
    return (def.kicker ? '<p style="font-size:24px;letter-spacing:4px;text-transform:uppercase;color:' + th.accent + ';font-weight:600">' + esc(def.kicker) + "</p>" : "") +
      '<h2 style="font-family:' + th.head + ";font-size:" + (size || 68) + 'px;font-weight:700;letter-spacing:-1px;line-height:1.1">' + rich(def.title || "") + "</h2>";
  }
  function bar(th) { return '<div style="width:96px;height:6px;border-radius:3px;background:' + th.accent + '"></div>'; }
  function list(items, th, size, build) {
    return '<ul style="font-size:' + (size || 38) + 'px;line-height:1.5;display:flex;flex-direction:column;gap:14px;padding-left:44px">' +
      (items || []).map(function (it) {
        var text = typeof it === "object" ? it.text : it;
        var sub = typeof it === "object" && it.sub ? '<ul style="font-size:' + Math.round((size || 38) * 0.78) + 'px;color:' + th.muted + ';padding-left:36px;margin-top:6px">' +
          it.sub.map(function (s) { return "<li>" + rich(s) + "</li>"; }).join("") + "</ul>" : "";
        return "<li>" + rich(text) + sub + "</li>";
      }).join("") + "</ul>";
  }

  var L = {};

  L.title = function (d, th) {
    return section(d, th,
      '<div data-deco style="position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none;background:radial-gradient(circle at 85% 15%, ' + th.accent + '33, transparent 55%), radial-gradient(circle at 10% 90%, ' + th.accent2 + '26, transparent 50%)"></div>' +
      bar(th) +
      (d.kicker ? '<p style="font-size:26px;letter-spacing:5px;text-transform:uppercase;color:' + th.accent + ';font-weight:600">' + esc(d.kicker) + "</p>" : "") +
      '<h1 style="font-family:' + th.head + ';font-size:124px;font-weight:800;letter-spacing:-3px;line-height:1.02;width:1500px">' + rich(d.title || "") + "</h1>" +
      (d.subtitle ? '<p style="font-size:40px;color:' + th.muted + ';width:1400px">' + rich(d.subtitle) + "</p>" : "") +
      (d.footer ? '<p style="position:absolute;left:128px;bottom:72px;width:1600px;font-size:24px;color:' + th.muted + '">' + rich(d.footer) + "</p>" : ""),
      { style: "justify-content:center;gap:32px" });
  };

  L.section = function (d, th) {
    return section(d, th,
      (d.number != null ? '<p style="font-family:' + th.head + ';font-size:180px;font-weight:800;color:' + th.accent + ';line-height:1">' + esc(d.number) + "</p>" : bar(th)) +
      '<h2 style="font-family:' + th.head + ';font-size:96px;font-weight:700;letter-spacing:-2px;line-height:1.05;width:1500px">' + rich(d.title || "") + "</h2>" +
      (d.subtitle ? '<p style="font-size:38px;color:' + th.muted + ';width:1300px">' + rich(d.subtitle) + "</p>" : ""),
      { bg: th.bg2, style: "justify-content:center;gap:28px" });
  };

  L.bullets = function (d, th) {
    var body = list(d.bullets, th, d.size || 38);
    return section(d, th, heading(d, th) + body + (d.footnote ? '<p style="position:absolute;left:128px;bottom:64px;width:1600px;font-size:24px;color:' + th.muted + '">' + rich(d.footnote) + "</p>" : ""));
  };

  L.kpis = function (d, th) {
    var items = (d.items || []).slice(0, 4);
    var cards = items.map(function (k) {
      var delta = k.delta ? '<p style="font-size:26px;font-weight:600;color:' + (String(k.delta).trim()[0] === "-" ? "#f87171" : th.accent) + '">' + esc(k.delta) + "</p>" : "";
      return '<div style="flex:1;display:flex;flex-direction:column;gap:14px;padding:44px 40px;border-radius:28px;background:' + th.surface + ";border:2px solid " + th.line + '">' +
        '<p style="font-size:24px;letter-spacing:2px;text-transform:uppercase;color:' + th.muted + ';font-weight:600">' + esc(k.label) + "</p>" +
        '<p style="font-family:' + th.head + ';font-size:' + (items.length > 3 ? 92 : 112) + 'px;font-weight:800;letter-spacing:-3px;line-height:1">' + esc(k.value) + "</p>" + delta +
        (k.note ? '<p style="font-size:26px;color:' + th.muted + '">' + rich(k.note) + "</p>" : "") + "</div>";
    }).join("");
    return section(d, th, heading(d, th) + '<div style="display:flex;gap:32px">' + cards + "</div>" +
      (d.takeaway ? '<p style="font-size:34px;color:' + th.fg + ';width:1600px">' + rich(d.takeaway) + "</p>" : ""));
  };

  L.table = function (d, th) {
    var cols = d.columns || [];
    var n = cols.length || 1, size = cols.length > 5 || (d.rows || []).length > 7 ? 26 : 30;
    var align = d.align || [];
    var tr = function (cells, head) {
      return '<tr style="' + (head ? "" : "") + '">' + cells.map(function (c, i) {
        var a = align[i] || (i > 0 && /^[-+]?[\d\s.,%]+[\w%€$]*$/.test(String(c)) ? "right" : "left");
        return (head ? '<th style="width:' + Math.round(100 / n) + "%;text-align:" + a + ";color:" + th.muted + ';font-weight:600">' : '<td style="text-align:' + a + '">') + rich(c) + (head ? "</th>" : "</td>");
      }).join("") + "</tr>";
    };
    return section(d, th, heading(d, th, 60) +
      '<table style="width:1664px;font-size:' + size + "px;color:" + th.fg + '">' + tr(cols, true) + (d.rows || []).slice(0, 12).map(function (r) { return tr(r, false); }).join("") + "</table>" +
      (d.note ? '<p style="font-size:24px;color:' + th.muted + '">' + rich(d.note) + "</p>" : ""));
  };

  L["two-col"] = function (d, th) {
    var col = function (c) {
      c = c || {};
      return '<div style="flex:1;display:flex;flex-direction:column;gap:20px;padding:44px;border-radius:28px;background:' + th.surface + ";border:2px solid " + th.line + '">' +
        (c.heading ? '<h3 style="font-family:' + th.head + ';font-size:44px;font-weight:700;color:' + (c.accent ? th.accent : th.fg) + '">' + rich(c.heading) + "</h3>" : "") +
        (c.bullets ? list(c.bullets, th, 32) : "") + (c.text ? '<p style="font-size:32px;line-height:1.45;color:' + th.muted + '">' + rich(c.text) + "</p>" : "") + "</div>";
    };
    return section(d, th, heading(d, th, 60) + '<div style="display:flex;gap:36px;flex:1">' + col(d.left) + col(d.right) + "</div>");
  };

  L.quote = function (d, th) {
    return section(d, th,
      '<p style="font-family:' + th.head + ';font-size:220px;line-height:0.6;color:' + th.accent + ';font-weight:800">“</p>' +
      '<h2 style="font-family:' + th.head + ';font-size:64px;font-weight:600;line-height:1.25;letter-spacing:-1px;width:1500px">' + rich(d.quote || "") + "</h2>" +
      (d.by ? '<p style="font-size:30px;color:' + th.muted + '">— ' + esc(d.by) + "</p>" : ""),
      { style: "justify-content:center;gap:36px" });
  };

  L.image = function (d, th) {
    var fit = d.fit === "contain" ? "contain" : "cover";
    return section(d, th, heading(d, th, 56) +
      '<img src="' + esc(d.image || "") + '" alt="' + esc(d.alt || d.caption || "") + '" style="width:1664px;height:' + (d.caption ? 600 : 680) + "px;object-fit:" + fit + ';border-radius:24px">' +
      (d.caption ? '<p style="font-size:26px;color:' + th.muted + '">' + rich(d.caption) + "</p>" : ""), { style: "gap:32px" });
  };

  L.chart = function (d, th) {
    var labels = d.labels || [], series = d.series || (d.values ? [{ name: d.title || "", values: d.values }] : []);
    var W = 1664, H = 600, M = { t: 40, r: 20, b: 70, l: 90 };
    var max = Math.max.apply(null, [0].concat.apply([], series.map(function (s) { return s.values.map(Number).filter(isFinite); }))) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
    var colors = [th.accent, th.accent2, "#fbbf24", "#fb7185", "#38bdf8"];
    var y = function (v) { return M.t + (H - M.t - M.b) * (1 - v / top); };
    var parts = [];
    for (var g = 0; g <= 4; g++) {
      var gv = top * g / 4, gy = y(gv);
      parts.push('<line x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + gy + '" y2="' + gy + '" stroke="' + th.line + '" stroke-width="2"/>');
      parts.push('<text x="' + (M.l - 16) + '" y="' + (gy + 9) + '" text-anchor="end" font-size="26" fill="' + th.muted + '" font-family="Arial">' + esc(fmt(gv)) + "</text>");
    }
    var bandW = (W - M.l - M.r) / Math.max(1, labels.length);
    labels.forEach(function (lab, i) {
      parts.push('<text x="' + (M.l + bandW * (i + 0.5)) + '" y="' + (H - M.b + 44) + '" text-anchor="middle" font-size="26" fill="' + th.muted + '" font-family="Arial">' + esc(lab) + "</text>");
    });
    var kind = d.kind || "bar";
    series.forEach(function (s, j) {
      var c = colors[j % colors.length];
      if (kind === "line") {
        var pts = s.values.map(function (v, i) { return (M.l + bandW * (i + 0.5)) + "," + y(+v || 0); }).join(" ");
        parts.push('<polyline points="' + pts + '" fill="none" stroke="' + c + '" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>');
        s.values.forEach(function (v, i) { parts.push('<circle cx="' + (M.l + bandW * (i + 0.5)) + '" cy="' + y(+v || 0) + '" r="9" fill="' + c + '"/>'); });
      } else {
        var bw = bandW * 0.7 / series.length;
        s.values.forEach(function (v, i) {
          var x = M.l + bandW * i + bandW * 0.15 + bw * j, yy = y(Math.max(0, +v || 0));
          parts.push('<rect x="' + x + '" y="' + yy + '" width="' + bw + '" height="' + (y(0) - yy) + '" rx="8" fill="' + c + '"/>');
          if (series.length === 1 && labels.length <= 14) parts.push('<text x="' + (x + bw / 2) + '" y="' + (yy - 14) + '" text-anchor="middle" font-size="26" font-weight="700" fill="' + th.fg + '" font-family="Arial">' + esc(fmt(v)) + "</text>");
        });
      }
    });
    function fmt(v) { v = +v; return Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(0) + "k" : String(Math.round(v * 10) / 10); }
    var legend = series.length > 1 ? '<div style="display:flex;gap:40px;font-size:26px;color:' + th.muted + '">' + series.map(function (s, j) {
      return '<p><span style="color:' + colors[j % colors.length] + '">■</span> ' + esc(s.name) + "</p>"; }).join("") + "</div>" : "";
    return section(d, th, heading(d, th, 56) + legend +
      '<svg aria-label="' + esc(d.title || "chart") + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '">' + parts.join("") + "</svg>" +
      (d.note ? '<p style="font-size:24px;color:' + th.muted + '">' + rich(d.note) + "</p>" : ""), { style: "gap:28px" });
  };

  L.blank = function (d, th) { return section(d, th, ""); };

  L.closing = function (d, th) {
    return section(d, th,
      '<div data-deco style="position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none;background:radial-gradient(circle at 50% 120%, ' + th.accent + '40, transparent 60%)"></div>' +
      '<h1 style="font-family:' + th.head + ';font-size:130px;font-weight:800;letter-spacing:-3px;text-align:center;width:1664px">' + rich(d.title || "") + "</h1>" +
      (d.subtitle ? '<p style="font-size:40px;color:' + th.muted + ';text-align:center;width:1664px">' + rich(d.subtitle) + "</p>" : ""),
      { style: "justify-content:center;align-items:center;gap:28px" });
  };

  window.slideLayout = function (def, theme) {
    var th = themeOf(theme), f = L[def.layout || "bullets"] || L.bullets;
    return f(def, th);
  };
  window.slideLayouts = Object.keys(L);
  window.slideTheme = themeOf;
})();
