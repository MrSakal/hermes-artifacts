/* hermes-artifacts dashboard check: what the drawn page shows, measured in the page itself, and sent
 * to the agent as the "check" (did the page come out right?) and "runs" (how did each source load?)
 * reports — the feedback Claude's dashboards give their agent.
 *
 * window.dashCheck.run({root, datasets, rowsOf, statusOf, errors, version, params}) -> {check, runs}
 */
(function () {
  "use strict";

  function num(text) {
    if (text == null) return NaN;
    var s = String(text).trim();
    var neg = /^[-−–]/.test(s) || /▼/.test(s);
    var pct = /%/.test(s);
    var m = s.replace(/[▲▼+−–-]/g, "").match(/[\d\s.,]+/);
    if (!m) return NaN;
    var core = m[0].replace(/\s/g, "");
    if (/,\d{1,2}$/.test(core) && !/\.\d/.test(core)) core = core.replace(/\./g, "").replace(",", ".");
    else core = core.replace(/,/g, "");
    var n = parseFloat(core);
    if (isNaN(n)) return NaN;
    var tail = s.slice(s.indexOf(m[0]) + m[0].length).trim();
    var scale = /^(k|thousand)\b/i.test(tail) ? 1e3 : /^(m|mn|million)\b/i.test(tail) ? 1e6 : /^(b|bn|billion)\b/i.test(tail) ? 1e9 : 1;
    n *= scale;
    if (neg) n = -n;
    return pct ? n / 100 : n;
  }

  function close(shown, value) {
    if (isNaN(shown) || isNaN(value)) return true; // not a number on one side: nothing to compare
    if (value === 0) return Math.abs(shown) < 1e-9;
    var rel = Math.abs(shown - value) / Math.abs(value);
    // A shown number is a rounded one: allow its own precision, at least 0.6 %.
    return rel < 0.006 || Math.abs(shown - value) <= 0.51 || Math.abs(shown * 100 - value) / Math.abs(value) < 0.006;
  }

  function where(attr) {
    if (!attr) return null;
    var o = {};
    attr.split("&").forEach(function (kv) {
      var p = kv.split("=");
      if (p[0]) o[decodeURIComponent(p[0])] = decodeURIComponent(p.slice(1).join("="));
    });
    return o;
  }

  function first(rows, wh) {
    var keys = Object.keys(wh);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (keys.every(function (k) { return String(r[k]) === wh[k]; })) return r;
    }
    return undefined;
  }

  function label(el) {
    var cur = el;
    for (var i = 0; cur && i < 6; i++, cur = cur.parentElement) {
      if (cur.id) return "#" + cur.id;
      var h = cur.querySelector && cur.querySelector(".c-h, h1, h2, h3, .c-label");
      if (h && h.textContent.trim()) return h.textContent.trim().slice(0, 60);
    }
    return el.tagName.toLowerCase();
  }

  function overlaps(a, b) {
    return a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;
  }

  window.dashCheck = {
    run: function (o) {
      var root = o.root, page = [], marks = [], flagged = 0;

      // 1. What the page's own code threw.
      (o.errors || []).forEach(function (e) { page.push({ kind: e.kind || "error", name: e.name || "Error", what: e.message, file: e.file, count: e.count || 1 }); });

      // 2. NaN / undefined / Infinity shown as text.
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), node, seen = 0;
      while ((node = walker.nextNode()) && seen < 10) {
        var t = node.textContent;
        if (/\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]/.test(t)) {
          seen++;
          page.push({ kind: "output", what: /NaN/.test(t) ? "not_a_number" : /undefined/.test(t) ? "undefined" : /object/.test(t) ? "object_as_text" : "infinity",
            at: label(node.parentElement), text: t.trim().slice(0, 80) });
        }
      }

      // 3. Charts: empty, labels over each other, labels cut off.
      root.querySelectorAll("svg").forEach(function (svg) {
        var host = svg.closest("[data-source]");
        var ids = host ? (host.getAttribute("data-source") || "").split(/\s+/).filter(Boolean) : [];
        var hasData = ids.some(function (id) { var s = o.statusOf(id); return s.status === "ok" && s.rows > 0; });
        // Axes, ticks and gridlines are not data: a chart showing only those is empty. One mark drawn is enough.
        var drawn = hasData && Array.prototype.some.call(svg.querySelectorAll("rect, path, circle, polyline, line, polygon, ellipse"), function (m) {
          if (m.closest(".tick, .c-axis, .c-grid") || m.classList.contains("domain") || m.classList.contains("c-ref")) return false;
          if (m.getAttribute("fill") === "transparent") return false;
          var r = m.getBoundingClientRect(); return r.width > 0.5 || r.height > 0.5;
        });
        if (hasData && !drawn) page.push({ kind: "output", what: "empty_chart", at: label(svg) });
        var box = svg.getBoundingClientRect(), rects = [];
        Array.prototype.forEach.call(svg.querySelectorAll("text"), function (t) {
          if (!t.textContent.trim()) return;
          var r = t.getBoundingClientRect();
          if (r.width > 0) rects.push(r);
        });
        var over = 0, cut = 0;
        for (var i = 0; i < rects.length && over < 3; i++) {
          for (var j = i + 1; j < rects.length; j++) if (overlaps(rects[i], rects[j])) { over++; break; }
          var r = rects[i];
          if (r.left < box.left - 3 || r.right > box.right + 3 || r.top < box.top - 3 || r.bottom > box.bottom + 3) cut++;
        }
        if (over) page.push({ kind: "output", what: "labels_overlap", at: label(svg), count: over });
        if (cut) page.push({ kind: "output", what: "labels_cut", at: label(svg), count: cut });
      });

      // 4. Marks: the number shown against the data it names.
      root.querySelectorAll("[data-source][data-field]").forEach(function (el) {
        if (el.tagName === "TABLE" || el.tagName === "TH") return;
        var ids = (el.getAttribute("data-source") || "").split(/\s+/).filter(Boolean);
        if (ids.length !== 1) return;
        var st = o.statusOf(ids[0]);
        if (st.status !== "ok") return;
        var field = el.getAttribute("data-field"), wh = where(el.getAttribute("data-where")), rowAttr = el.getAttribute("data-row");
        var rows = o.rowsOf(ids[0]);
        if (!rows) return;
        var row = rowAttr != null ? rows[+rowAttr] : wh ? first(rows, wh) : rows[0];
        var shownText = (el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild.textContent : el.textContent).trim();
        if (!row) {
          if (shownText && shownText !== "—") { flagged++; if (marks.length < 20) marks.push({ mark: label(el), source: ids[0], field: field, where: wh, row: rowAttr, reason: "matches no row" }); }
          return;
        }
        var value = row[field];
        var v = typeof value === "number" ? value : num(value);
        var shown = num(shownText);
        if (!isNaN(v) && !isNaN(shown) && !close(shown, v)) {
          flagged++;
          if (marks.length < 20) marks.push({ mark: label(el), source: ids[0], field: field, where: wh, row: rowAttr, shown: shownText.slice(0, 40), inData: value });
        }
      });

      var datasets = {};
      Object.keys(o.datasets).forEach(function (id) {
        var s = o.statusOf(id);
        datasets[id] = { status: s.status, message: s.message || undefined, rows: s.rows, ms: s.ms, at: s.at, cached: s.cached || undefined };
      });
      var failedSources = Object.keys(datasets).filter(function (id) { return /^(error|failed|missing|reauth|absent|off|denied|refused)$/.test(datasets[id].status); });
      var check = {
        version: o.version, at: new Date().toISOString(),
        status: page.length || marks.length || failedSources.length ? "failed" : "passed",
        page: page.slice(0, 30), marks: marks, flagged: flagged,
        sources: failedSources.map(function (id) { return { dataset: id, status: datasets[id].status, message: datasets[id].message }; })
      };
      var runs = { version: o.version, at: check.at, params: o.params, datasets: datasets, marks: marks, flagged: flagged,
        errors: (o.errors || []).slice(0, 20) };
      return { check: check, runs: runs };
    }
  };
})();
