/* hermes-artifacts dashboard components: the page drawn from a declarative `layout` in dashboard.json,
 * so the agent writes data and a short description instead of HTML and chart code each time.
 *
 *   "layout": [
 *     {"type": "header", "title": "Orders 2026", "subtitle": "{orders} orders so far"},
 *     {"type": "filters", "items": [{"param": "region", "label": "Region", "input": "select", "options": {"source": "regions", "field": "region"}}]},
 *     {"type": "kpis", "items": [{"id": "orders", "label": "Orders", "source": "monthly", "field": "orders", "agg": "sum", "format": "int"}]},
 *     {"type": "chart", "kind": "bar", "title": "Per month", "source": "monthly", "x": "month", "y": "value"},
 *     {"type": "table", "title": "By region", "source": "regions", "key": "region", "columns": [{"field": "region"}, {"field": "value", "format": "number", "bar": true}]},
 *     {"type": "text", "text": "**Note:** …"}
 *   ]
 *
 * Every value carries the marks Sources reads (data-source / data-field / data-where), so "where
 * numbers come from" works without the agent marking anything. Exposes window.dashLayout(layout, root).
 */
(function () {
  "use strict";
  var kit = window.kit;
  var h = kit.h;

  // ---------------------------------------------------------------- values
  function num(v) {
    if (typeof v === "number") return v;
    if (v == null || v === "") return NaN;
    var s = String(v).replace(/\s/g, "").replace(/,(\d{1,2})$/, ".$1").replace(/,/g, "");
    return +s;
  }
  function lang() { return undefined; } // numbers and dates in the viewer's own locale; the words are English

  function format(v, f) {
    if (v == null || v === "" || (typeof v === "number" && isNaN(v))) return "—";
    var loc = lang(), n = num(v);
    f = f || (typeof v === "number" ? "number" : "text");
    var m;
    if (f === "text") return String(v);
    if (f === "int") return isNaN(n) ? String(v) : new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(n);
    if (f === "number") return isNaN(n) ? String(v) : new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(n);
    if ((m = /^number:(\d)$/.exec(f))) return isNaN(n) ? String(v) : new Intl.NumberFormat(loc, { minimumFractionDigits: +m[1], maximumFractionDigits: +m[1] }).format(n);
    if (f === "compact") return isNaN(n) ? String(v) : new Intl.NumberFormat(loc, { notation: "compact", maximumFractionDigits: 1 }).format(n);
    if (f === "percent") return isNaN(n) ? String(v) : new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 1 }).format(n);
    if (f === "percent100") return isNaN(n) ? String(v) : new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(n) + "%";
    if ((m = /^currency:([A-Z]{3})$/.exec(f))) return isNaN(n) ? String(v) : new Intl.NumberFormat(loc, { style: "currency", currency: m[1], maximumFractionDigits: m[1] === "HUF" ? 0 : 2 }).format(n);
    if (f === "date" || f === "month" || f === "datetime") {
      var d = new Date(typeof v === "number" ? v * (v < 1e12 ? 1000 : 1) : String(v).length === 7 ? v + "-01" : v);
      if (isNaN(d)) return String(v);
      var o = f === "month" ? { year: "numeric", month: "short" } : f === "date" ? { year: "numeric", month: "short", day: "numeric" } : { dateStyle: "medium", timeStyle: "short" };
      return new Intl.DateTimeFormat(loc, o).format(d);
    }
    return String(v);
  }

  /** "{param}" inside a where value is the filter's current value. */
  function paramValue(v) {
    var m = typeof v === "string" && /^\{([A-Za-z_]\w*)\}$/.exec(v);
    if (!m) return v;
    var p = window.dash.params()[m[1]];
    return p == null ? "" : p;
  }
  function filterRows(rows, where) {
    if (!where) return rows;
    var conds = Object.keys(where).map(function (k) { return [k, paramValue(where[k])]; })
      .filter(function (c) { return c[1] !== "" && c[1] != null; }); // an empty filter = all rows
    return rows.filter(function (r) { return conds.every(function (c) { return String(r[c[0]]) === String(c[1]); }); });
  }
  function whereAttr(where) {
    if (!where) return null;
    var parts = Object.keys(where).map(function (k) { var v = paramValue(where[k]); return v === "" ? null : encodeURIComponent(k) + "=" + encodeURIComponent(v); }).filter(Boolean);
    return parts.length ? parts.join("&") : null;
  }

  function aggregate(rows, agg, field) {
    var vals = rows.map(function (r) { return r[field]; });
    var nums = vals.map(num).filter(function (x) { return !isNaN(x); });
    switch (agg || "first") {
      case "sum": return nums.reduce(function (a, b) { return a + b; }, 0);
      case "avg": return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : NaN;
      case "min": return nums.length ? Math.min.apply(null, nums) : NaN;
      case "max": return nums.length ? Math.max.apply(null, nums) : NaN;
      case "count": return rows.length;
      case "countDistinct": return new Set(vals.map(String)).size;
      case "last": return vals.length ? vals[vals.length - 1] : null;
      default: return vals.length ? vals[0] : null;
    }
  }

  /** Rows of a source after its where; the dataset's status alongside. */
  function rowsOf(spec) {
    var d = window.dash.data(spec.source);
    var rows = d.status === "ok" ? (d.rows && d.rows.length ? d.rows : Array.isArray(d.data) ? d.data : d.value && typeof d.value === "object" ? [d.value] : []) : [];
    return { d: d, rows: filterRows(rows, spec.where) };
  }

  /** Group rows by x and aggregate each y. */
  function grouped(rows, x, ys, agg) {
    if (!agg) return rows;
    var map = new Map();
    rows.forEach(function (r) { var k = r[x]; if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
    return Array.from(map, function (e) {
      var o = {}; o[x] = e[0];
      ys.forEach(function (y) { o[y] = aggregate(e[1], agg, y); });
      return o;
    });
  }

  function sortRows(rows, sort) {
    if (!sort) return rows;
    var desc = sort[0] === "-", f = desc ? sort.slice(1) : sort;
    return rows.slice().sort(function (a, b) {
      var x = num(a[f]), y = num(b[f]), c = !isNaN(x) && !isNaN(y) ? x - y : String(a[f]).localeCompare(String(b[f]));
      return desc ? -c : c;
    });
  }

  // ---------------------------------------------------------------- templates ("{kpi}" / "{param:x}")
  var values = {}; // kpi id -> formatted value
  function fill(text) {
    return String(text || "").replace(/\{(param:)?([A-Za-z_]\w*)\}/g, function (m, isParam, name) {
      if (isParam) { var p = window.dash.params()[name]; return p == null ? "" : String(p); }
      return values[name] != null ? values[name] : "—";
    });
  }
  /** Minimal inline markdown: **bold**, *italic*, [text](https://…). Text only, never HTML. */
  function inline(el, text) {
    el.replaceChildren();
    var re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) el.appendChild(h("strong", { text: m[1] }));
      else if (m[2]) el.appendChild(h("em", { text: m[2] }));
      else el.appendChild(h("a", { href: m[4], target: "_blank", rel: "noopener noreferrer", text: m[3] }));
      last = re.lastIndex;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  function stateLine(box, d) {
    if (d.status === "ok") return false;
    box.replaceChildren(d.status === "loading" ? h("div", { "class": "c-skel" }) :
      h("div", { "class": "dash-failed", text: d.message || d.status }));
    return true;
  }

  // ---------------------------------------------------------------- blocks
  var builders = {};

  builders.header = function (b) {
    var t = h("h1", { "class": "c-title" }), s = h("p", { "class": "c-sub" });
    return { el: h("header", { "class": "c-header c-full" }, [t, s]), draw: function () {
      t.textContent = fill(b.title || kit.content.title || "");
      if (b.subtitle) inline(s, fill(b.subtitle)); else s.hidden = true;
    } };
  };

  builders.text = function (b) {
    var p = h("div", { "class": "c-text" + (b.width === "half" ? "" : " c-full") });
    return { el: p, draw: function () {
      p.replaceChildren.apply(p, String(fill(b.text || "")).split(/\n{2,}/).map(function (para) { var e = h("p"); inline(e, para); return e; }));
    } };
  };

  builders.filters = function (b) {
    var bar = h("div", { "class": "c-filters c-full" }), controls = [];
    (b.items || []).forEach(function (f) {
      var lab = h("label", { "class": "c-filter" }, [h("span", { text: f.label || f.param })]);
      var ctl;
      if (f.input === "text" || f.input === "number" || f.input === "date") {
        ctl = h("input", { type: f.input, placeholder: f.placeholder || "", "aria-label": f.label || f.param,
          pattern: f.pattern || null, min: f.min != null ? String(f.min) : null, max: f.max != null ? String(f.max) : null });
        var apply = function () {
          var v = ctl.value;
          if (ctl.validity && !ctl.validity.valid) return;
          var o = {}; o[f.param] = f.input === "number" ? (v === "" ? null : +v) : v;
          window.dash.setParams(o);
        };
        ctl.addEventListener("keydown", function (e) { if (e.key === "Enter") apply(); });
        if (f.input === "date") ctl.addEventListener("change", apply);
        else ctl.addEventListener("blur", apply);
      } else {
        ctl = h("select", { "aria-label": f.label || f.param });
        ctl.addEventListener("change", function () { var o = {}; o[f.param] = ctl.value === "" ? null : ctl.value; window.dash.setParams(o); });
      }
      lab.appendChild(ctl);
      bar.appendChild(lab);
      controls.push({ f: f, ctl: ctl });
    });
    if (b.reset !== false) {
      bar.appendChild(h("button", { type: "button", "class": "c-btn", text: "Reset",
        onclick: function () { window.dash.resetParams(); } }));
    }
    return { el: bar, draw: function () {
      var p = window.dash.params();
      controls.forEach(function (c) {
        if (c.ctl.tagName === "SELECT") {
          var opts = c.f.options;
          var list = Array.isArray(opts) ? opts : opts && opts.source ? (function () {
            var r = rowsOf({ source: opts.source });
            return Array.from(new Set(r.rows.map(function (x) { return x[opts.field]; }))).filter(function (x) { return x != null && x !== ""; });
          })() : [];
          var cur = p[c.f.param] == null ? "" : String(p[c.f.param]);
          var items = (c.f.all !== false ? [{ value: "", label: c.f.all || "All" }] : [])
            .concat(list.map(function (o) { return typeof o === "object" ? { value: String(o.value), label: String(o.label != null ? o.label : o.value) } : { value: String(o), label: format(o, c.f.format || "text") }; }));
          c.ctl.replaceChildren.apply(c.ctl, items.map(function (o) { return new Option(o.label, o.value, false, o.value === cur); }));
          c.ctl.value = cur;
        } else if (document.activeElement !== c.ctl) {
          c.ctl.value = p[c.f.param] == null ? "" : String(p[c.f.param]);
        }
      });
    } };
  };

  builders.kpis = function (b) {
    var wrap = h("div", { "class": "c-kpis c-full" }), cells = [];
    (b.items || []).forEach(function (k) {
      var val = h("div", { "class": "c-kpi-value", "data-source": k.source, "data-field": k.agg && k.agg !== "first" && k.agg !== "last" ? null : k.field,
        "data-where": whereAttr(k.where) });
      var delta = h("div", { "class": "c-kpi-delta" }), note = h("div", { "class": "c-kpi-note" });
      var card = h("div", { "class": "c-card c-kpi" }, [h("div", { "class": "c-label", text: k.label || k.field }), val, delta, note]);
      wrap.appendChild(card);
      cells.push({ k: k, val: val, delta: delta, note: note });
    });
    return { el: wrap, draw: function () {
      cells.forEach(function (c) {
        var k = c.k, r = rowsOf(k);
        if (r.d.status !== "ok") { c.val.textContent = "—"; c.val.classList.toggle("dash-skeleton", r.d.status === "loading"); return; }
        c.val.classList.remove("dash-skeleton");
        var v = aggregate(r.rows, k.agg, k.field);
        var text = format(v, k.format) + (k.unit ? " " + k.unit : "");
        c.val.textContent = format(v, k.format);
        if (k.unit) c.val.appendChild(h("span", { "class": "c-unit", text: " " + k.unit }));
        if (k.id) values[k.id] = text;
        if (k.where) c.val.setAttribute("data-where", whereAttr(k.where) || ""); // follows the filters
        if (k.delta) {
          var dr = rowsOf(Object.assign({ source: k.source, field: k.field, agg: k.agg }, k.delta));
          var base = aggregate(dr.rows, k.delta.agg || k.agg, k.delta.field || k.field);
          var cur = num(v), prev = num(base);
          if (!isNaN(cur) && !isNaN(prev) && prev !== 0) {
            var ch = (cur - prev) / Math.abs(prev), good = (ch >= 0) === (k.delta.good !== "down");
            c.delta.textContent = (ch >= 0 ? "▲ " : "▼ ") + format(Math.abs(ch), "percent") + (k.delta.label ? " " + k.delta.label : "");
            c.delta.className = "c-kpi-delta " + (good ? "up" : "down");
          } else c.delta.textContent = "";
        }
        if (k.note) inline(c.note, fill(k.note));
      });
    } };
  };

  // --- charts ------------------------------------------------------------------------------------
  var tip = null;
  function tooltip(show, x, y, html) {
    if (!tip) { tip = h("div", { "class": "c-tip" }); document.body.appendChild(tip); }
    if (!show) { tip.style.display = "none"; return; }
    tip.replaceChildren.apply(tip, html);
    tip.style.display = "block";
    var w = tip.offsetWidth;
    tip.style.left = Math.min(innerWidth - w - 8, x + 12) + "px";
    tip.style.top = (y + 14) + "px";
  }

  builders.chart = function (b) {
    var box = h("div", { "class": "c-chart", "data-source": b.source });
    var card = h("section", { "class": "c-card c-block" + (b.width === "full" ? " c-full" : "") }, [
      b.title ? h("h2", { "class": "c-h", text: b.title }) : null,
      b.note ? h("p", { "class": "c-note", text: b.note }) : null, box]);
    return { el: card, draw: function () {
      var d3 = window.d3, r = rowsOf(b);
      if (stateLine(box, r.d)) return;
      var ys = Array.isArray(b.y) ? b.y : [b.y];
      var rows = sortRows(grouped(r.rows, b.x, ys, b.agg), b.sort);
      if (b.limit) rows = rows.slice(0, b.limit);
      if (!rows.length) { box.replaceChildren(h("div", { "class": "dash-failed", text: "No data" })); return; }
      var colors = window.dash.colorValues ? window.dash.colorValues() : window.dash.colors;
      var W = Math.max(280, box.clientWidth || 480), kind = b.kind || "bar";
      var H = b.height || (kind === "hbar" ? Math.max(160, rows.length * 30 + 40) : kind === "donut" ? 240 : 260);
      var svg = d3.create("svg").attr("viewBox", "0 0 " + W + " " + H).attr("width", "100%").attr("role", "img")
        .attr("aria-label", b.title || "chart");
      var fx = function (v) { return format(v, b.xFormat || "text"); }, fy = function (v) { return format(v, b.format || "number"); };

      if (kind === "donut") {
        var y0 = ys[0], R = Math.min(W / 2, H) / 2 - 8;
        var pie = d3.pie().sort(null).value(function (d) { return Math.max(0, num(d[y0])) || 0; })(rows);
        var arc = d3.arc().innerRadius(R * 0.62).outerRadius(R).cornerRadius(3).padAngle(0.012);
        var g = svg.append("g").attr("transform", "translate(" + (R + 8) + "," + H / 2 + ")");
        g.selectAll("path").data(pie).join("path").attr("d", arc).attr("fill", function (d, i) { return colors[i % colors.length]; })
          .on("mousemove", function (e, d) { tooltip(true, e.clientX, e.clientY, [h("b", { text: fx(d.data[b.x]) }), h("div", { text: fy(d.data[y0]) })]); })
          .on("mouseleave", function () { tooltip(false); });
        var total = d3.sum(rows, function (d) { return num(d[y0]) || 0; });
        g.append("text").attr("text-anchor", "middle").attr("dy", "0.35em").attr("class", "c-donut-total").text(fy(total));
        var lg = svg.append("g").attr("transform", "translate(" + (2 * R + 32) + "," + Math.max(16, H / 2 - rows.length * 11) + ")");
        rows.slice(0, 12).forEach(function (d, i) {
          var row = lg.append("g").attr("transform", "translate(0," + i * 22 + ")");
          row.append("rect").attr("width", 10).attr("height", 10).attr("rx", 2).attr("y", -9).attr("fill", colors[i % colors.length]);
          row.append("text").attr("x", 16).attr("class", "c-axis-text").text(fx(d[b.x]) + " · " + fy(d[y0]) + (total ? " (" + format(num(d[y0]) / total, "percent") + ")" : ""));
        });
        box.replaceChildren(svg.node());
        return;
      }

      var M = { t: 16, r: 16, b: 30, l: 44 };
      if (kind === "hbar") {
        var labelW = Math.min(W * 0.4, d3.max(rows, function (d) { return fx(d[b.x]).length; }) * 7 + 12);
        M.l = labelW;
        var yb = d3.scaleBand(rows.map(function (d) { return String(d[b.x]); }), [M.t, H - M.b]).padding(0.28);
        var xl = d3.scaleLinear([0, d3.max(rows, function (d) { return d3.max(ys, function (y) { return num(d[y]) || 0; }); }) || 1], [M.l, W - M.r - 40]).nice();
        svg.append("g").attr("class", "c-axis").attr("transform", "translate(" + M.l + ",0)").call(d3.axisLeft(yb).tickSize(0).tickFormat(function (v) { return fx(v); }))
          .call(function (g) { g.select(".domain").remove(); });
        svg.append("g").selectAll("rect").data(rows).join("rect")
          .attr("x", M.l).attr("y", function (d) { return yb(String(d[b.x])); }).attr("height", yb.bandwidth())
          .attr("width", function (d) { return Math.max(0, xl(num(d[ys[0]]) || 0) - M.l); }).attr("rx", 3).attr("fill", colors[0])
          .on("mousemove", function (e, d) { tooltip(true, e.clientX, e.clientY, [h("b", { text: fx(d[b.x]) }), h("div", { text: fy(d[ys[0]]) })]); })
          .on("mouseleave", function () { tooltip(false); });
        svg.append("g").selectAll("text").data(rows).join("text").attr("class", "c-value")
          .attr("x", function (d) { return xl(num(d[ys[0]]) || 0) + 6; }).attr("y", function (d) { return yb(String(d[b.x])) + yb.bandwidth() / 2; })
          .attr("dy", "0.35em").text(function (d) { return fy(d[ys[0]]); });
        box.replaceChildren(svg.node());
        return;
      }

      var xs = rows.map(function (d) { return String(d[b.x]); });
      var x = d3.scaleBand(xs, [M.l, W - M.r]).padding(kind === "bar" ? 0.24 : 0);
      var ymax = d3.max(rows, function (d) { return d3.max(ys, function (y) { return num(d[y]) || 0; }); }) || 1;
      if (b.reference && !isNaN(num(b.reference.value))) ymax = Math.max(ymax, num(b.reference.value));
      var y = d3.scaleLinear([0, ymax], [H - M.b, M.t]).nice();
      svg.append("g").attr("class", "c-grid").attr("transform", "translate(" + M.l + ",0)")
        .call(d3.axisLeft(y).ticks(4).tickSize(-(W - M.l - M.r)).tickFormat(function (v) { return format(v, "compact"); }))
        .call(function (g) { g.select(".domain").remove(); });
      var every = Math.ceil(xs.length / Math.max(1, Math.floor((W - M.l) / 56)));
      svg.append("g").attr("class", "c-axis").attr("transform", "translate(0," + (H - M.b) + ")")
        .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat(function (v, i) { return i % every ? "" : fx(v); }))
        .call(function (g) { g.select(".domain").remove(); });
      if (kind === "bar") {
        var sub = d3.scaleBand(ys, [0, x.bandwidth()]).padding(0.08);
        ys.forEach(function (yk, j) {
          svg.append("g").selectAll("rect").data(rows).join("rect")
            .attr("x", function (d) { return x(String(d[b.x])) + sub(yk); }).attr("width", sub.bandwidth())
            .attr("y", function (d) { return y(Math.max(0, num(d[yk]) || 0)); })
            .attr("height", function (d) { return y(0) - y(Math.max(0, num(d[yk]) || 0)); })
            .attr("rx", 3).attr("fill", colors[j % colors.length])
            .on("mousemove", function (e, d) { tooltip(true, e.clientX, e.clientY, [h("b", { text: fx(d[b.x]) })].concat(ys.map(function (k) { return h("div", { text: k + ": " + fy(d[k]) }); }))); })
            .on("mouseleave", function () { tooltip(false); });
        });
        if (rows.length <= 16 && ys.length === 1) {
          svg.append("g").selectAll("text").data(rows).join("text").attr("class", "c-value").attr("text-anchor", "middle")
            .attr("x", function (d) { return x(String(d[b.x])) + x.bandwidth() / 2; }).attr("y", function (d) { return y(num(d[ys[0]]) || 0) - 5; })
            .text(function (d) { return format(d[ys[0]], b.format === "number" || !b.format ? "compact" : b.format); });
        }
      } else {
        var cx = function (d) { return x(String(d[b.x])) + x.bandwidth() / 2; };
        ys.forEach(function (yk, j) {
          var line = d3.line().defined(function (d) { return !isNaN(num(d[yk])); }).x(cx).y(function (d) { return y(num(d[yk])); });
          if (kind === "area") {
            var area = d3.area().defined(function (d) { return !isNaN(num(d[yk])); }).x(cx).y0(y(0)).y1(function (d) { return y(num(d[yk])); });
            svg.append("path").attr("d", area(rows)).attr("fill", colors[j % colors.length]).attr("opacity", 0.16);
          }
          svg.append("path").attr("d", line(rows)).attr("fill", "none").attr("stroke", colors[j % colors.length]).attr("stroke-width", 2.2)
            .attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
          svg.append("g").selectAll("circle").data(rows).join("circle").attr("cx", cx).attr("cy", function (d) { return y(num(d[yk]) || 0); })
            .attr("r", rows.length > 40 ? 0 : 3).attr("fill", colors[j % colors.length]);
        });
        svg.append("g").selectAll("rect").data(rows).join("rect").attr("x", function (d) { return x(String(d[b.x])); })
          .attr("width", Math.max(2, x.bandwidth() || (W - M.l - M.r) / rows.length)).attr("y", M.t).attr("height", H - M.t - M.b).attr("fill", "transparent")
          .on("mousemove", function (e, d) { tooltip(true, e.clientX, e.clientY, [h("b", { text: fx(d[b.x]) })].concat(ys.map(function (k) { return h("div", { text: k + ": " + fy(d[k]) }); }))); })
          .on("mouseleave", function () { tooltip(false); });
      }
      if (b.reference && !isNaN(num(b.reference.value))) {
        var ry = y(num(b.reference.value));
        svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", ry).attr("y2", ry).attr("class", "c-ref");
        if (b.reference.label) svg.append("text").attr("x", W - M.r).attr("y", ry - 5).attr("text-anchor", "end").attr("class", "c-axis-text").text(b.reference.label);
      }
      if (ys.length > 1) {
        var lg2 = svg.append("g").attr("transform", "translate(" + M.l + ",4)"), ox = 0;
        ys.forEach(function (k, j) {
          var name = (b.labels && b.labels[k]) || k;
          lg2.append("rect").attr("x", ox).attr("y", 0).attr("width", 10).attr("height", 10).attr("rx", 2).attr("fill", colors[j % colors.length]);
          lg2.append("text").attr("x", ox + 14).attr("y", 9).attr("class", "c-axis-text").text(name);
          ox += 24 + name.length * 7;
        });
      }
      box.replaceChildren(svg.node());
    } };
  };

  builders.table = function (b) {
    var cols = b.columns || [];
    var search = b.search ? h("input", { type: "search", "class": "c-search", placeholder: "Search…" }) : null;
    var thead = h("thead"), tbody = h("tbody");
    var table = h("table", { "class": "c-table", "data-source": b.source, "data-row-key": b.key || (cols[0] && cols[0].field) || null }, [thead, tbody]);
    var scroller = h("div", { "class": "c-table-wrap", style: b.maxHeight ? "max-height:" + b.maxHeight + "px" : null }, [table]);
    var card = h("section", { "class": "c-card c-block" + (b.width === "half" ? "" : " c-full") }, [
      h("div", { "class": "c-block-head" }, [b.title ? h("h2", { "class": "c-h", text: b.title }) : null, search]),
      b.note ? h("p", { "class": "c-note", text: b.note }) : null, scroller]);
    var sortBy = b.sort || null;
    if (search) search.addEventListener("input", function () { draw(); });
    function draw() {
      var r = rowsOf(b);
      if (r.d.status !== "ok") { tbody.replaceChildren(h("tr", {}, [h("td", { colspan: String(cols.length || 1), "class": "dash-failed", text: r.d.status === "loading" ? "…" : (r.d.message || r.d.status) })])); return; }
      var cs = cols.length ? cols : (r.d.columns || []).map(function (c) { return { field: c }; });
      thead.replaceChildren(h("tr", {}, cs.map(function (c) {
        var active = sortBy === c.field || sortBy === "-" + c.field;
        return h("th", { "data-field": c.field, "class": (c.align === "right" || /number|int|percent|currency|compact/.test(c.format || "") ? "num" : "") + (active ? " sorted" : ""),
          "aria-sort": active ? (sortBy[0] === "-" ? "descending" : "ascending") : null,
          onclick: function () { sortBy = sortBy === c.field ? "-" + c.field : c.field; draw(); },
          text: (c.label || c.field) + (active ? (sortBy[0] === "-" ? " ↓" : " ↑") : "") });
      })));
      var rows = sortRows(r.rows, sortBy);
      var q = search && search.value.trim().toLowerCase();
      if (q) rows = rows.filter(function (row) { return cs.some(function (c) { return String(row[c.field] == null ? "" : row[c.field]).toLowerCase().indexOf(q) >= 0; }); });
      if (b.limit) rows = rows.slice(0, b.limit);
      var maxes = {};
      cs.forEach(function (c) { if (c.bar) maxes[c.field] = Math.max.apply(null, rows.map(function (x) { return num(x[c.field]) || 0; }).concat([0])) || 1; });
      tbody.replaceChildren.apply(tbody, rows.map(function (row) {
        var key = row[table.getAttribute("data-row-key")];
        return h("tr", { "data-key": key == null ? null : String(key) }, cs.map(function (c) {
          var v = row[c.field], td = h("td", { "class": c.align === "right" || /number|int|percent|currency|compact/.test(c.format || "") ? "num" : null });
          var shown = format(v, c.format || "text");
          if (c.link) {
            var url = String(c.link === true ? v : row[c.link] != null ? row[c.link] : c.link.replace(/\{(\w+)\}/g, function (m, f) { return encodeURIComponent(row[f] == null ? "" : row[f]); }));
            if (/^(https?:|mailto:)/i.test(url) || /^\//.test(url)) td.appendChild(h("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: shown }));
            else td.textContent = shown;
          } else td.textContent = shown;
          if (c.bar) {
            var pct = Math.max(0, Math.min(100, (num(v) || 0) / maxes[c.field] * 100));
            td.classList.add("c-barcell");
            td.style.setProperty("--pct", pct + "%");
          }
          return td;
        }));
      }));
    }
    return { el: card, draw: draw };
  };

  builders.grid = function (b) {
    var parts = (b.items || []).map(build).filter(Boolean);
    var el = h("div", { "class": "c-grid-row c-full", style: "grid-template-columns:repeat(" + Math.max(1, Math.min(4, b.columns || parts.length || 2)) + ", minmax(0, 1fr))" },
      parts.map(function (p) { p.el.classList.remove("c-full"); return p.el; }));
    return { el: el, draw: function () { parts.forEach(function (p) { p.draw(); }); } };
  };

  function build(b) {
    var f = b && builders[b.type];
    if (!f) return { el: h("div", { "class": "dash-err c-full", text: "unknown layout block: " + JSON.stringify(b && b.type) }), draw: function () {} };
    return f(b);
  }

  /** Mount a layout into root; returns nothing — drawing runs through dash.onData like any page. */
  window.dashLayout = function (layout, root) {
    var parts = (layout || []).map(build);
    var page = h("div", { "class": "c-page" }, parts.map(function (p) { return p.el; }));
    root.appendChild(page);
    // KPIs first: headers and notes read their values.
    var order = parts.filter(function (p, i) { return layout[i].type === "kpis"; }).concat(parts.filter(function (p, i) { return layout[i].type !== "kpis"; }));
    window.dash.onData(function () { order.forEach(function (p) { p.draw(); }); });
  };
  window.dashFormat = format;
})();
