/* hermes-artifacts Dashboard runtime.
 *
 * Content (the artifact's files):
 *   dashboard.json  {title?, page?: "index.html", params?: {name: default},
 *                    datasets: {<id>: {title, description?, source, updated?: {at, by}, schedule?,
 *                                      staleAfterHours?, fixed?}}}
 *     source: {kind: "file", path: "data/x.csv", format?: "csv"|"tsv"|"json"}
 *           | {kind: "rows", rows: [{...}]}
 *   index.html      the page, mounted into #dash-root; its scripts get `dash` and `d3`.
 *
 * The whole runtime runs inside the artifact's sandboxed frame (opaque origin), so the page's own
 * scripts can't reach Hermes; they still go through a cleanup (no forms, frames, on* handlers,
 * outside scripts) so a page stays a page.
 */
(function () {
  "use strict";
  var kit = window.kit, h = kit.h, C = kit.content;
  var spec = kit.json("dashboard.json", null);
  var root = document.getElementById("dash-root");
  var bar = document.getElementById("dash-bar");
  var L = /^hu\b/i.test(kit.content.lang || navigator.language || "") ? "hu" : "en";
  var T = {
    en: { use: "Use the page", where: "Where numbers come from", refresh: "Refresh", sources: "Sources",
      exp: "Export", csv: "Data as CSV", snap: "Snapshot (HTML)", json: "Data and page (JSON)", file: "File",
      rows: "Saved rows", calc: "Calculation", params: "Filters", failed: "Failed to load", none: "Nothing on this dashboard yet.",
      bad: "dashboard.json is missing or not valid JSON.", stopped: "This page's code stopped", stale: "Out of date",
      updated: "updated", unused: "Not read by the page", preview: "Result", formula: "Formula", desc: "",
      saved: "Downloaded", notmarked: "Nothing on the page links here", value: "a value", rowsN: "rows",
      live: "Live", ago: "refreshed", cached: "from cache", noBridge: "Live data needs Hermes Desktop",
      askTitle: "This dashboard gets its numbers live", askBody: "It runs these queries through Hermes each time it opens or refreshes:",
      allow: "Allow", decline: "Not now", declined: "Live data was not allowed", waiting: "Waiting for approval",
      query: "Query", refreshSrc: "Refresh this source", took: "took",
      refreshAll: "Run every live query again", updatedAgo: "Updated", now: "now", refreshing: "Refreshing…", csvOf: "CSV",
      reauthTitle: "Sign in to {s} again", reauthBody: "Its login has expired, so these numbers can't be fetched until you sign in.",
      absentTitle: "{s} is not connected", absentBody: "Connect it in Hermes to fetch these numbers.",
      offTitle: "{s} is turned off", offBody: "Turn it on in Hermes to fetch these numbers.",
      affected: "Waiting", signIn: "Sign in", openConnectors: "Open connectors", retry: "Try again",
      editQuery: "Edit query", editHint: "The call's arguments as JSON. Saving makes a new version and runs the changed query.",
      save: "Save", cancel: "Cancel", saving: "Saving…", badJson: "Not valid JSON", conflict: "Changed meanwhile: reload first", querySaved: "Query saved",
      test: "Test", testing: "Running the test…", testOk: "Test ran: {n} rows in {ms} ms. Nothing is saved until you press Save.",
      testStale: "Edited since the test: test again before saving.", history: "History", historyHint: "Pick one to put it in the editor. Nothing changes until you save.",
      historyNone: "No earlier versions yet.", restored: "Earlier version in the editor. Nothing changes until you save.", you: "You", current: "current",
      back: "Back", close: "Close", justNow: "Just now", copy: "Copy", copied: "Copied", expand: "Expand", downloadCsv: "Download CSV",
      showMore: "Show more", showLess: "Show less", transform: "Transform", row1: "row", noSources: "This dashboard has no sources.", noArgs: "No arguments." },
    hu: { use: "Az oldal használata", where: "Honnan jönnek a számok", refresh: "Frissítés", sources: "Források",
      exp: "Exportálás", csv: "Adatok CSV-ben", snap: "Pillanatkép (HTML)", json: "Adatok és oldal (JSON)", file: "Fájl",
      rows: "Mentett sorok", calc: "Számítás", params: "Szűrők", failed: "Nem töltött be", none: "Ezen a dashboardon még nincs semmi.",
      bad: "A dashboard.json hiányzik, vagy nem érvényes JSON.", stopped: "Az oldal kódja leállt", stale: "Elavult",
      updated: "frissítve", unused: "Az oldal nem olvassa", preview: "Eredmény", formula: "Képlet", desc: "",
      saved: "Letöltve", notmarked: "Az oldalon semmi nem hivatkozik rá", value: "egy érték", rowsN: "sor",
      live: "Élő", ago: "frissítve", cached: "gyorsítótárból", noBridge: "Az élő adathoz a Hermes Desktop kell",
      askTitle: "Ez a dashboard élőben kéri le a számait", askBody: "Megnyitáskor és frissítéskor ezeket a lekérdezéseket futtatja a Hermesen keresztül:",
      allow: "Engedélyezés", decline: "Most nem", declined: "Az élő adat nincs engedélyezve", waiting: "Jóváhagyásra vár",
      query: "Lekérdezés", refreshSrc: "Ennek a forrásnak a frissítése", took: "időtartam",
      refreshAll: "Minden élő lekérdezés újrafuttatása", updatedAgo: "Frissítve", now: "most", refreshing: "Frissítés…", csvOf: "CSV",
      reauthTitle: "Jelentkezz be újra: {s}", reauthBody: "Lejárt a bejelentkezés, ezért amíg újra be nem lépsz, ezeket a számokat nem tudja lekérni.",
      absentTitle: "{s} nincs csatlakoztatva", absentBody: "Csatlakoztasd a Hermesben, hogy le tudja kérni ezeket a számokat.",
      offTitle: "{s} ki van kapcsolva", offBody: "Kapcsold be a Hermesben, hogy le tudja kérni ezeket a számokat.",
      affected: "Erre vár", signIn: "Bejelentkezés", openConnectors: "Kapcsolatok megnyitása", retry: "Újrapróbálás",
      editQuery: "Lekérdezés szerkesztése", editHint: "A hívás argumentumai JSON-ként. A mentés új verziót készít, és lefuttatja a módosított lekérdezést.",
      save: "Mentés", cancel: "Mégse", saving: "Mentés…", badJson: "Nem érvényes JSON", conflict: "Közben megváltozott: előbb töltsd újra", querySaved: "Lekérdezés elmentve",
      test: "Teszt", testing: "Teszt fut…", testOk: "A teszt lefutott: {n} sor, {ms} ms. Mentésig semmi nem változik.",
      testStale: "A teszt óta módosítottad: mentés előtt teszteld újra.", history: "Előzmények", historyHint: "Válassz egyet, és bekerül a szerkesztőbe. Mentésig semmi nem változik.",
      historyNone: "Még nincs korábbi változat.", restored: "Korábbi változat a szerkesztőben. Mentésig semmi nem változik.", you: "Te", current: "jelenlegi",
      back: "Vissza", close: "Bezárás", justNow: "Épp most", copy: "Másolás", copied: "Kimásolva", expand: "Nagyítás", downloadCsv: "Letöltés CSV-ben",
      showMore: "Több", showLess: "Kevesebb", transform: "Átalakítás", row1: "sor", noSources: "Ennek a dashboardnak nincs forrása.", noArgs: "Nincs argumentum." }
  }[L];

  // ------------------------------------------------------------------ data
  var datasets = (spec && spec.datasets) || {};
  var loaders = {}, calcs = {}, cache = {}, used = {}, gen = 0;
  var paramDefaults = (spec && spec.params) || {};
  var params = JSON.parse(JSON.stringify(paramDefaults));
  var drawers = [], errors = [];

  function parseDelimited(text, sep) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var rows = [], row = [], cell = "", q = false, i = 0, c;
    for (; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === "") q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    var cols = (rows.shift() || []).map(function (s) { return s.trim(); });
    return { columns: cols, rows: rows.map(function (r) {
      var o = {}; cols.forEach(function (k, j) { o[k] = r[j] === undefined ? null : r[j]; }); return o;
    }) };
  }

  function asTable(v) {
    if (Array.isArray(v)) {
      var cols = [];
      v.forEach(function (r) { if (r && typeof r === "object") Object.keys(r).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
      return { columns: cols, rows: v };
    }
    if (v && typeof v === "object") {
      if (Array.isArray(v.rows) || Array.isArray(v.data) || Array.isArray(v.results)) {
        var t = asTable(v.rows || v.data || v.results);
        if (Array.isArray(v.columns)) t.columns = v.columns;
        t.meta = v.meta || [];
        return t;
      }
    }
    return { columns: [], rows: [], value: v };
  }

  // ---------------------------------------------------------------- live sources (stored MCP calls)
  var live = {}, liveQueue = [], liveActive = 0, LIVE_MAX = 4;
  function isLive(d) { var k = d && d.source && d.source.kind; return k === "call" || k === "query"; }
  function paramNames(v, out) {
    out = out || {};
    if (typeof v === "string") v.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g, function (_, n) { out[n] = 1; });
    else if (v && typeof v === "object") Object.keys(v).forEach(function (k) { paramNames(v[k], out); });
    return out;
  }
  function pump() {
    while (liveActive < LIVE_MAX && liveQueue.length) {
      var job = liveQueue.shift();
      liveActive++;
      job().then(function () { liveActive--; pump(); });
    }
  }
  /** mode "live": run the query (open, refresh, filter change). mode "cached": the last answer if
   *  there is one (thumbnails, and the instant paint on open), else a live run. */
  function loadLive(id, force, mode) {
    var st = live[id] || (live[id] = { status: "loading" });
    if (!window.hermes || !window.hermes.dataset) { st.status = "error"; st.message = T.noBridge; return; }
    if (st.running) { st.again = st.again || true; return; }
    st.running = true;
    if (st.status === "ok") st.refreshing = true; else if (st.status !== "approval") st.status = "loading";
    liveQueue.push(function () {
      return window.hermes.dataset.run(id, params, false, C.version, mode === "cached" ? "cached" : "live").then(function (r) {
        var keep = st.status === "ok" ? { rows: st.rows, columns: st.columns, answer: st.answer } : {};
        Object.keys(st).forEach(function (k) { if (k !== "running" && k !== "again") delete st[k]; });
        Object.assign(st, r || {});
        if (st.status !== "ok" && keep.rows && st.status !== "approval") Object.assign(st, { stale: keep });
      }).catch(function (e) {
        st.status = "error"; st.message = String(e && e.message || e);
      }).then(function () {
        st.running = false; st.refreshing = false;
        gen++; redraw(); banner();
        if (st.again) { st.again = false; loadLive(id, true); return; }
        // Opened from the last answer: now the live run, keeping those numbers on screen meanwhile.
        if (st.cached && st.status === "ok" && !C.thumb && !st.revalidated) { st.revalidated = true; loadLive(id, true); }
      });
    });
    pump();
  }
  function liveIds() { return Object.keys(datasets).filter(function (id) { return isLive(datasets[id]); }); }
  function refreshLive(force, changed) {
    liveIds().forEach(function (id) {
      if (changed) {
        var ns = paramNames(datasets[id].source.args || {});
        if (!changed.some(function (k) { return ns[k]; })) return;
      }
      loadLive(id, force);
    });
  }
  function liveResult(id) {
    var st = live[id];
    if (!st) { loadLive(id, false, "cached"); st = live[id]; } // instant paint; live follows (thumbnails stop there)
    if (st.status === "ok") {
      var t = st.rows ? { columns: st.columns || [], rows: st.rows } : asTable(st.answer);
      return Object.assign({ status: "ok", meta: st.meta || [] }, t);
    }
    if (st.status === "loading") return { status: "loading" };
    if (st.status === "approval") return { status: "connect", message: T.waiting };
    if (st.status === "declined") return { status: "declined", message: T.declined };
    if (st.status === "reauth" || st.status === "absent" || st.status === "off") {
      // Keep the last numbers on screen (dimmed) while the connector is out; say why in the banner.
      if (st.stale && st.stale.rows) return Object.assign({ status: "ok", stale: true }, { columns: st.stale.columns || [], rows: st.stale.rows });
      return { status: st.status, message: st.message };
    }
    return { status: "error", message: st.message || st.status };
  }

  function loadRaw(id) {
    var d = datasets[id];
    if (!d) return { status: "missing", message: "no dataset " + id };
    var s = d.source || {};
    if (isLive(d)) return liveResult(id);
    try {
      if (s.kind === "rows") return Object.assign({ status: "ok" }, asTable(s.rows || []));
      if (s.kind === "file") {
        var text = kit.fileText(s.path);
        if (text == null) return { status: "error", message: "file not in the artifact: " + s.path };
        var fmt = s.format || (/\.tsv$/i.test(s.path) ? "tsv" : /\.json$/i.test(s.path) ? "json" : "csv");
        if (fmt === "json") return Object.assign({ status: "ok" }, asTable(JSON.parse(text)));
        return Object.assign({ status: "ok" }, parseDelimited(text, fmt === "tsv" ? "\t" : ","));
      }
      return { status: "error", message: "unknown source kind " + JSON.stringify(s.kind) };
    } catch (e) {
      return { status: "error", message: String(e && e.message || e) };
    }
  }

  function compute(id) {
    if (calcs[id]) {
      var c = calcs[id], args = [];
      for (var i = 0; i < c.inputs.length; i++) {
        var r = get(c.inputs[i]);
        if (r.status !== "ok") return { status: r.status === "error" ? "error" : r.status, message: "input " + c.inputs[i] + ": " + (r.message || r.status) };
        args.push(r.value !== undefined && !(r.rows || []).length ? r.value : (r.rows || []).map(function (o) { return Object.assign({}, o); }));
      }
      try {
        var out = c.fn.apply(null, args);
        var t = Array.isArray(out) ? asTable(out) : { columns: [], rows: [], value: out };
        return Object.assign({ status: "ok", calc: true }, t);
      } catch (e) { return { status: "error", message: String(e && e.message || e) }; }
    }
    var raw = loadRaw(id);
    if (raw.status === "ok" && datasets[id] && (datasets[id].rowsAt || datasets[id].fields || datasets[id].types)) {
      try { raw = reshape(datasets[id], raw, live[id] && live[id].answer); }
      catch (e) { raw = { status: "error", message: String(e && e.message || e) }; }
    }
    if (raw.status === "ok" && loaders[id]) {
      try {
        var ans = live[id] && live[id].answer !== undefined ? live[id].answer : raw.value !== undefined ? raw.value : raw.rows;
        var res = loaders[id].fn({ answer: ans, rows: raw.rows, columns: raw.columns, params: params });
        var tt = asTable(res);
        raw = Object.assign({ status: "ok" }, tt);
      } catch (e) { raw = { status: "error", message: String(e && e.message || e) }; }
    }
    return raw;
  }

  function parseMaybe(v) {
    if (typeof v === "string") { var t = v.trim(); if (t[0] === "{" || t[0] === "[") { try { return JSON.parse(t); } catch (e) {} } }
    return v;
  }
  /** rowsAt: "result.results" (JSON strings parsed on the way, MCP content[] unwrapped);
   *  fields: {"title": "title", "url": "contentUrl"} (new name -> source path);
   *  types: {"hours": "number", "day": "date"}. */
  function reshape(d, raw, answer) {
    var base = answer !== undefined ? answer : raw.value !== undefined ? raw.value : raw.rows;
    var rows = raw.rows;
    if (d.rowsAt) {
      var cur = parseMaybe(base);
      if (cur && Array.isArray(cur.content) && cur.content[0] && cur.content[0].text != null) cur = parseMaybe(cur.content[0].text);
      String(d.rowsAt).split(".").filter(Boolean).forEach(function (k) { cur = parseMaybe(cur == null ? cur : cur[k]); });
      if (!Array.isArray(cur)) throw new Error("rowsAt " + d.rowsAt + " is not a list");
      rows = cur;
    }
    if (d.fields) {
      var map = d.fields;
      rows = rows.map(function (r) {
        var o = {};
        Object.keys(map).forEach(function (k) {
          var v = r;
          String(map[k]).split(".").forEach(function (p) { v = v == null ? v : parseMaybe(v)[p]; });
          o[k] = v;
        });
        return o;
      });
    }
    if (d.types) {
      rows = rows.map(function (r) {
        var o = Object.assign({}, r);
        Object.keys(d.types).forEach(function (k) {
          var t = d.types[k], v = o[k];
          if (v == null) return;
          if (t === "number") o[k] = typeof v === "number" ? v : +String(v).replace(/\s/g, "").replace(",", ".");
          else if (t === "date") o[k] = String(v).slice(0, 10);
          else if (t === "month") o[k] = String(v).slice(0, 7);
          else if (t === "text") o[k] = String(v);
        });
        return o;
      });
    }
    return Object.assign({ status: "ok" }, asTable(rows));
  }

  function get(id) {
    used[id] = true;
    if (!cache[id] || cache[id].gen !== gen) cache[id] = { gen: gen, r: compute(id) };
    return cache[id].r;
  }

  function view(id) {
    var r = get(id);
    var rows = (r.rows || []).map(function (o) { return Object.assign({}, o); });
    return { status: r.status, data: r.value !== undefined && !rows.length ? r.value : rows, rows: rows,
      columns: (r.columns || []).slice(), message: r.message || null, refreshing: !!(live[id] && live[id].refreshing), meta: r.meta || [],
      value: r.value };
  }

  var scheduled = false;
  function redraw() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      drawers.forEach(run);
      stamp();
      tickFresh();
      if (srcOpen) renderSources();
      scheduleCheck();
      sendView();
    });
  }
  function run(fn) {
    try { fn(); } catch (e) { pageError(e, fn.__file); }
  }

  var colors = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6", "--chart-7", "--chart-8"]
    .map(function (v) { return "var(" + v + ")"; });
  var colorValues = function () {
    var cs = getComputedStyle(document.documentElement);
    return colors.map(function (v) { return cs.getPropertyValue(v.slice(4, -1)).trim(); });
  };

  var currentFile = "index.html";
  var dash = {
    data: view,
    onData: function (fn) { fn.__file = currentFile; drawers.push(fn); run(fn); },
    calc: function (id, o) {
      if (datasets[id]) throw new Error("calc id " + id + " is a dataset id");
      calcs[id] = { inputs: (o && o.inputs) || [], fn: o.fn, title: o.title || id, description: o.description || "" };
      gen++; redraw();
    },
    loader: function (id, o) { loaders[id] = { fn: o.fn, description: o.description || "" }; gen++; redraw(); },
    refresh: function (id) { if (id && live[id]) loadLive(id, true); else refreshLive(true); gen++; redraw(); },
    params: function () { return JSON.parse(JSON.stringify(params)); },
    setParams: function (p) {
      for (var k in p) {
        var v = p[k];
        if (v === null || v === undefined) delete params[k];
        else if (["string", "number", "boolean"].indexOf(typeof v) >= 0 || Array.isArray(v)) params[k] = v;
      }
      saveParams(); gen++; redraw();
      refreshLive(false, Object.keys(p || {}));
    },
    resetParams: function () { params = JSON.parse(JSON.stringify(paramDefaults)); saveParams(); gen++; redraw(); refreshLive(false); },
    setLink: function (name) { try { history.replaceState(null, "", "#" + encodeURIComponent(name || "")); } catch (e) {} },
    colors: colors,
    colorValues: colorValues,
    format: function (n, o) {
      if (n == null || n === "" || isNaN(+n)) return "—";
      return new Intl.NumberFormat(L === "hu" ? "hu-HU" : "en-US", o || { maximumFractionDigits: 1 }).format(+n);
    }
  };
  window.dash = dash;

  function saveParams() {
    if (window.hermes) window.hermes.storage.set("dash.params", params).catch(function () {});
  }

  // ------------------------------------------------------------------ marks
  function stamp() {
    var marks = root.querySelectorAll("[data-source]");
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i], ids = (m.getAttribute("data-source") || "").split(/\s+/).filter(Boolean), st = "";
      for (var j = 0; j < ids.length; j++) {
        var r = cache[ids[j]] && cache[ids[j]].r;
        var s = r ? r.status : "loading";
        if (live[ids[j]] && live[ids[j]].refreshing) { st = st || "refreshing"; continue; }
        if (/^(error|missing|declined|connect|reauth|absent|off)$/.test(s)) { st = "error"; break; }
        if (s === "loading") st = "loading";
      }
      if (!st && !m.children.length && /^\s*[—-]?\s*$/.test(m.textContent)) st = "empty";
      if (st) m.setAttribute("data-dash-source-state", st); else m.removeAttribute("data-dash-source-state");
      // Data mode marks a short value with a dotted underline and a block with a dotted frame.
      var leaf = !m.children.length && m.textContent.trim().length <= 60 && !(m instanceof SVGElement);
      m.setAttribute("data-dash-mark", leaf ? "text" : "box");
    }
  }

  // ------------------------------------------------------------------ page
  var DROP = "script,link,meta,base,form,iframe,frame,frameset,object,embed,portal";
  var errorLog = {}; // name+message -> {kind, name, message, file, count}: what the page's code threw
  function logError(kind, e, file) {
    var name = (e && e.name) || "Error", message = String((e && e.message) || e || "").slice(0, 300);
    var key = kind + "|" + name + "|" + message;
    var rec = errorLog[key] || (errorLog[key] = { kind: kind, name: name, message: message, file: file || undefined, count: 0 });
    rec.count++;
    scheduleCheck();
  }
  function pageError(e, file) {
    logError("stopped", e, file);
    var msg = T.stopped + " (" + (file || "page") + "): " + (e && e.message || e);
    errors.push(msg);
    console.error(msg, e);
    var box = document.querySelector(".dash-err") || root.parentNode.insertBefore(h("div", { "class": "dash-err" }), root);
    box.textContent = errors.slice(-3).join(" · ");
  }

  function mount() {
    var pagePath = (spec && spec.page) || "index.html";
    var html = kit.fileText(pagePath);
    if (spec && Array.isArray(spec.layout) && window.dashLayout) {
      try { window.dashLayout(spec.layout, root); } catch (e) { pageError(e, "layout"); }
      if (html == null) { stamp(); return; }
      var extra = h("div", { "class": "c-page c-custom" });
      root.appendChild(extra);
      mountHtml(html, pagePath, extra);
      return;
    }
    if (html == null) { root.appendChild(h("div", { "class": "kit-empty", text: T.none })); return; }
    mountHtml(html, pagePath, root);
  }

  function mountHtml(html, pagePath, into) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html;
    var frag = tpl.content, scripts = [], styles = [];
    frag.querySelectorAll("link[rel~=stylesheet]").forEach(function (l) {
      var css = kit.fileText(l.getAttribute("href") || "");
      if (css != null) styles.push(css);
    });
    frag.querySelectorAll("style").forEach(function (s) { styles.push(s.textContent); s.remove(); });
    frag.querySelectorAll("script").forEach(function (s) {
      var type = (s.getAttribute("type") || "").toLowerCase();
      if (type && !/javascript|^module$/.test(type)) return;
      var src = s.getAttribute("src");
      if (src) { var t = kit.fileText(src); if (t != null) scripts.push({ file: src, code: t }); }
      else scripts.push({ file: pagePath, code: s.textContent });
    });
    frag.querySelectorAll(DROP).forEach(function (n) { n.remove(); });
    var all = frag.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var attrs = all[i].attributes;
      for (var j = attrs.length - 1; j >= 0; j--) {
        var a = attrs[j].name;
        if (/^on/i.test(a) || a === "ping" || ((a === "href" || a === "src" || a === "xlink:href") && /^\s*javascript:/i.test(attrs[j].value))) all[i].removeAttribute(a);
      }
    }
    // Images and other media named by path come from the artifact's files.
    frag.querySelectorAll("[src]").forEach(function (n) {
      var u = kit.fileUrl(n.getAttribute("src"));
      if (u) n.setAttribute("src", u);
    });
    if (styles.length) document.head.appendChild(h("style", { "data-page": "", text: styles.join("\n") }));
    into.replaceChildren(frag);
    scripts.forEach(function (s) {
      currentFile = s.file;
      try { new Function("dash", "d3", "(function(){" + s.code + "\n}).call(this);\n//# sourceURL=dash-page/" + s.file)(dash, window.d3); }
      catch (e) { pageError(e, s.file); }
    });
    currentFile = "index.html";
    stamp();
    var named = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (named) named.scrollIntoView();
  }

  window.addEventListener("error", function (e) {
    if (e.filename && e.filename.indexOf("dash-page/") >= 0) pageError(e.error || e.message, e.filename.split("dash-page/")[1]);
    else logError("error", e.error || e.message);
  });
  window.addEventListener("unhandledrejection", function (e) { logError("rejection", e.reason); });

  var lastW = 0;
  new ResizeObserver(function () { var w = root.clientWidth; if (w !== lastW) { lastW = w; redraw(); } }).observe(root);

  // ------------------------------------------------------------------ chrome
  var srcOpen = false, picked = null, drawer = null;

  function ago(at) {
    if (!at) return "";
    var t = typeof at === "number" ? at * (at < 1e12 ? 1000 : 1) : Date.parse(at);
    if (isNaN(t)) return String(at);
    var s = (Date.now() - t) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min";
    if (s < 86400) return Math.round(s / 3600) + " h";
    return new Date(t).toLocaleDateString();
  }
  function isStale(d) {
    if (!d.staleAfterHours || !d.updated || !d.updated.at) return false;
    var t = Date.parse(d.updated.at);
    return !isNaN(t) && Date.now() - t > d.staleAfterHours * 3600e3;
  }

  function toCsv(r) {
    var cols = r.columns && r.columns.length ? r.columns : Object.keys((r.rows || [])[0] || {});
    var q = function (v) {
      if (v == null) return "";
      v = typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return [cols.map(q).join(",")].concat((r.rows || []).map(function (o) { return cols.map(function (c) { return q(o[c]); }).join(","); })).join("\n");
  }

  function table(r, hit, full) {
    var cols = r.columns && r.columns.length ? r.columns : Object.keys((r.rows || [])[0] || {});
    var t = h("table");
    t.appendChild(h("tr", {}, cols.map(function (c) { return h("th", { "class": hit && hit.field === c ? "hit" : null, text: c }); })));
    (r.rows || []).slice(0, full ? 5000 : 200).forEach(function (o, i) {
      var rowHit = hit && (hit.row === i || (hit.where && hit.where.every(function (kv) { return String(o[kv[0]]) === kv[1]; })));
      t.appendChild(h("tr", {}, cols.map(function (c) {
        var v = o[c];
        return h("td", { "class": rowHit && (!hit.field || hit.field === c) ? "hit" : null, text: v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v) });
      })));
    });
    return h("div", { "class": "src-table" }, [t]);
  }

  function marked(id) { return !!root.querySelector('[data-source~="' + CSS.escape(id) + '"]'); }

  // Sources panel, the way Claude's reads: a flat list (name + kind icon); a source opens in place
  // with a back arrow, how fresh it is, its description, and one open section at a time (Query /
  // Transform / Formula / Result).
  var openSec = {}; // source id -> open section
  var descOpen = {}, codeOpen = {};
  function kindIcon(id) {
    if (calcs[id]) return "braces";
    var d = datasets[id] || {};
    return isLive(d) ? "data" : d.source && d.source.kind === "file" ? "file" : "braces";
  }
  function sourceTitle(id) { var d = datasets[id] || calcs[id] || {}; return d.title || id; }
  function freshOf(id) {
    var lv = live[id];
    if (lv && (lv.running || lv.status === "loading")) return T.refreshing;
    var at = lv && lv.at ? lv.at * 1000 : datasets[id] && datasets[id].updated && datasets[id].updated.at ? Date.parse(datasets[id].updated.at) : null;
    if (calcs[id]) {
      var ins = calcs[id].inputs.map(function (k) { return live[k] && live[k].at ? live[k].at * 1000 : null; }).filter(Boolean);
      at = ins.length ? Math.min.apply(null, ins) : Date.now();
    }
    if (!at || isNaN(at)) return "";
    return (Date.now() - at) / 1000 < 60 ? T.justNow : T.updatedAgo + " " + ago(at);
  }
  function copyText(text) {
    var done = function () { kit.toast(T.copied); };
    var fallback = function () {
      var ta = h("textarea", { style: "position:fixed;opacity:0;top:0;left:0" });
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) {}
      ta.remove();
    };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }
  function toTsv(r) {
    var cols = r.columns && r.columns.length ? r.columns : Object.keys((r.rows || [])[0] || {});
    var c = function (v) { return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v).replace(/[\t\n\r]+/g, " "); };
    return [cols.join("\t")].concat((r.rows || []).map(function (o) { return cols.map(function (k) { return c(o[k]); }).join("\t"); })).join("\n");
  }
  function iconBtn(icon, title, fn, extra) {
    return h("button", { "class": "src-ib" + (extra ? " " + extra : ""), type: "button", title: title, "aria-label": title, html: kit.icon(icon),
      onclick: function (e) { e.stopPropagation(); fn(e); } });
  }
  /** Code that shows a few lines, a copy button, and "Show more". */
  function codeBlock(key, text) {
    var long = String(text).split("\n").length > 8 || String(text).length > 420;
    var open = !!codeOpen[key];
    var pre = h("pre", { "class": "src-code" + (long && !open ? " clamped" : ""), text: String(text) });
    var kids = [pre, iconBtn("copy", T.copy, function () { copyText(String(text)); }, "src-code-copy")];
    if (long) kids.push(h("button", { "class": "src-more", type: "button", text: open ? T.showLess : T.showMore,
      onclick: function () { codeOpen[key] = !open; renderSources(); } }));
    return h("div", { "class": "src-codebox" }, kids);
  }
  function section(id, key, label, body) {
    var open = openSec[id] === key;
    return h("div", { "class": "src-sec2" + (open ? " open" : "") }, [
      h("button", { "class": "src-sec2-head", type: "button", "aria-expanded": String(open),
        onclick: function () { openSec[id] = open ? null : key; renderSources(); } },
        [h("span", { text: label }), h("span", { "class": "src-caret", html: kit.icon(open ? "caretDown" : "caretRight") })]),
      open ? h("div", { "class": "src-sec2-body" }, body()) : null
    ]);
  }
  function resultView(id, r, full) {
    if (r.status !== "ok") return [h("p", { "class": "src-warn", text: T.failed + ": " + (r.message || r.status) })];
    var isValue = r.value !== undefined && !(r.rows || []).length;
    var rows = isValue ? (r.value && typeof r.value === "object" && !Array.isArray(r.value) ? [r.value] : [{ value: r.value }]) : r.rows || [];
    var tools = h("div", { "class": "src-tools" }, [
      full ? null : iconBtn("expand", T.expand, function () { expandResult(id); }),
      iconBtn("copy", T.copy, function () { copyText(isValue ? JSON.stringify(r.value, null, 2) : toTsv(r)); }),
      iconBtn("download", T.downloadCsv, function () { kit.download(id + ".csv", toCsv(isValue ? asTable(rows) : r), "text/csv"); kit.toast(T.saved); })
    ]);
    var body;
    if (rows.length === 1) {
      var o = rows[0];
      body = h("div", { "class": "src-kv" }, Object.keys(o).map(function (k) {
        var v = o[k];
        return h("div", { "class": "src-kv-row" + (picked && picked.field === k ? " hit" : "") }, [h("div", { "class": "src-kv-k", text: k }),
          h("div", { "class": "src-kv-v", text: v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v) })]);
      }));
    } else body = table(isValue ? asTable(rows) : r, picked && picked.id === id ? picked : null, full);
    return [tools, body, h("div", { "class": "src-count", text: rows.length + " " + (rows.length === 1 ? T.row1 : T.rowsN) })];
  }
  var modal = null;
  function expandResult(id) {
    if (modal) modal.remove();
    var r = cache[id] ? cache[id].r : get(id);
    modal = h("div", { "class": "src-modal", onclick: function (e) { if (e.target === modal) { modal.remove(); modal = null; } } }, [
      h("div", { "class": "src-modal-card" }, [
        h("div", { "class": "src-modal-head" }, [h("b", { text: sourceTitle(id) }), h("span", { style: "flex:1" }),
          iconBtn("close", T.close, function () { modal.remove(); modal = null; })]),
        h("div", { "class": "src-modal-body" }, resultView(id, r, true))
      ])
    ]);
    document.body.appendChild(modal);
  }
  function argInputs(id, d) {
    var args = d.source.args || {};
    var draft = argDraft[id] || (argDraft[id] = JSON.parse(JSON.stringify(args)));
    var changed = JSON.stringify(draft) !== JSON.stringify(args);
    var kids = Object.keys(args).map(function (k) {
      var v = draft[k], obj = v && typeof v === "object";
      var inp = h(obj ? "textarea" : "input", { "class": "src-arg", spellcheck: "false", rows: obj ? "3" : null });
      inp.value = obj ? JSON.stringify(v) : v == null ? "" : String(v);
      inp.addEventListener("change", function () {
        var t = inp.value, nv = t;
        if (obj || typeof args[k] === "number" || typeof args[k] === "boolean") { try { nv = JSON.parse(t); } catch (e) { nv = t; } }
        draft[k] = nv; renderSources();
      });
      return h("label", { "class": "src-arg-row" }, [h("span", { "class": "src-arg-k", text: k }), inp]);
    });
    if (!kids.length) kids.push(h("p", { "class": "src-meta", text: T.noArgs }));
    var lv = live[id] || {};
    kids.push(h("p", { "class": "src-tool" }, [document.createTextNode((lv.server || d.source.server || d.source.connector || "MCP") + " · "),
      h("code", { text: d.source.tool || "" })].concat(lv.ms != null ? [document.createTextNode(" · " + lv.ms + " ms")] : [])));
    if (changed) kids.push(h("div", { "class": "src-actions" }, [
      kit.labelled(kit.button(T.save, "", function () { saveArgs(id, d, draft); }, T.save), T.save),
      kit.labelled(kit.button(T.cancel, "", function () { delete argDraft[id]; renderSources(); }, T.cancel), T.cancel)
    ]));
    return kids;
  }
  var argDraft = {};
  function saveArgs(id, d, args) {
    if (!window.hermes || !window.hermes.dataset || !window.hermes.dataset.edit) { kit.toast(T.noBridge); return; }
    window.hermes.dataset.edit(id, args, C.version).then(function (r) {
      if (r && r.conflict) { kit.toast(T.conflict); return; }
      C.version = r.version; d.source.args = args; delete argDraft[id]; delete live[id];
      loadLive(id, true); kit.toast(T.querySaved); renderSources();
    }).catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  function transformOf(id, d) {
    if (loaders[id]) return { desc: loaders[id].description, code: String(loaders[id].fn) };
    var shape = {};
    ["rowsAt", "fields", "types"].forEach(function (k) { if (d[k]) shape[k] = d[k]; });
    return Object.keys(shape).length ? { desc: d.transform || "", code: JSON.stringify(shape, null, 2) } : null;
  }

  function renderList() {
    var head = h("div", { "class": "src-head" }, [h("b", { text: T.sources }), iconBtn("close", T.close, function () { toggleSources(false); })]);
    var ids = Object.keys(datasets).concat(Object.keys(calcs).filter(function (k) { return !datasets[k]; }));
    var list = h("div", { "class": "src-list" }, ids.map(function (id) {
      var r = cache[id] ? cache[id].r : null;
      var bad = r && r.status !== "ok" && r.status !== "loading";
      return h("button", { "class": "src-li", type: "button", onclick: function () { openSource(id); } }, [
        h("span", { "class": "src-li-t", text: sourceTitle(id) }),
        bad ? h("span", { "class": "src-dot error", title: r.message || r.status }) : null,
        h("span", { "class": "src-kind", html: kit.icon(kindIcon(id)) })
      ]);
    }));
    return [head, ids.length ? list : h("p", { "class": "src-empty", text: T.noSources })];
  }

  function renderDetail(id) {
    var isCalc = !!calcs[id] && !datasets[id];
    var d = isCalc ? calcs[id] : datasets[id];
    if (!d) { picked = null; return renderList(); }
    var r = cache[id] ? cache[id].r : get(id);
    var lv = !isCalc && isLive(d) ? live[id] || {} : null;
    if (openSec[id] === undefined) openSec[id] = isCalc ? "formula" : lv ? "query" : "result";
    var head = h("div", { "class": "src-head" }, [
      iconBtn("prev", T.back, function () { picked = null; root.querySelectorAll(".dash-picked").forEach(function (n) { n.classList.remove("dash-picked"); }); renderSources(); }),
      h("span", { style: "flex:1" }),
      h("span", { "class": "src-fresh", text: freshOf(id) }),
      lv ? iconBtn("refresh", T.refreshSrc, function () { loadLive(id, true); renderSources(); }) : null,
      iconBtn("close", T.close, function () { toggleSources(false); })
    ]);
    var desc = d.description || "";
    var longDesc = desc.length > 150;
    var top = h("div", { "class": "src-top" }, [
      h("div", { "class": "src-title-row" }, [h("b", { "class": "src-title", text: sourceTitle(id) }),
        lv ? iconBtn("pencil", T.editQuery, function () { editing = editing === id ? null : id; openSec[id] = "query"; renderSources(); }) : null]),
      desc ? h("p", { "class": "src-desc" + (longDesc && !descOpen[id] ? " clamped" : ""), text: desc }) : null,
      longDesc ? h("button", { "class": "src-more", type: "button", text: descOpen[id] ? T.showLess : T.showMore,
        onclick: function () { descOpen[id] = !descOpen[id]; renderSources(); } }) : null
    ]);
    var warn = [];
    if (!isCalc && isStale(d)) warn.push(h("p", { "class": "src-warn", text: T.stale + (d.schedule ? " · " + d.schedule : "") }));
    if (!isCalc && !marked(id)) warn.push(h("p", { "class": "src-meta", text: used[id] ? T.notmarked : T.unused }));
    var secs = [];
    if (lv) secs.push(section(id, "query", T.query, function () { return editing === id ? [queryEditor(id, d)] : argInputs(id, d); }));
    if (!isCalc && d.source && d.source.kind === "file") secs.push(section(id, "file", T.file, function () {
      return [h("p", { "class": "src-tool" }, [h("code", { text: d.source.path || "" })])];
    }));
    var tf = !isCalc && transformOf(id, d);
    if (tf) secs.push(section(id, "transform", T.transform, function () {
      return [tf.desc ? h("p", { "class": "src-desc", text: tf.desc }) : null, codeBlock(id + ":t", tf.code)];
    }));
    if (isCalc) secs.push(section(id, "formula", T.formula, function () {
      return [h("div", { "class": "src-inputs" }, d.inputs.map(function (k) {
        return h("button", { "class": "src-li", type: "button", onclick: function () { openSource(k); } },
          [h("span", { "class": "src-li-t", text: sourceTitle(k) }), h("span", { "class": "src-kind", html: kit.icon(kindIcon(k)) })]);
      })), codeBlock(id + ":f", String(d.fn))];
    }));
    secs.push(section(id, "result", T.preview, function () { return resultView(id, r, false); }));
    return [head, h("div", { "class": "src-detail" }, [top].concat(warn, secs))];
  }

  function openSource(id, hit) {
    picked = Object.assign({ id: id }, hit || {});
    if (hit && (hit.field || hit.where || hit.row != null)) openSec[id] = "result";
    renderSources();
    if (drawer) drawer.scrollTop = 0;
  }

  function renderSources() {
    if (!drawer) return;
    drawer.replaceChildren.apply(drawer, (picked ? renderDetail(picked.id) : renderList()).filter(Boolean));
  }

  var editing = null;
  function queryEditor(id, d) {
    var ta = h("textarea", { "class": "src-edit", spellcheck: "false", rows: "10" });
    ta.value = JSON.stringify(d.source.args || {}, null, 2);
    var msg = h("p", { "class": "src-meta", text: T.editHint });
    var testOut = h("div", { "class": "src-test" });
    var histBox = h("div", { "class": "src-hist", hidden: true });
    var tested = null; // the text that was tested, so a later edit marks the result as out of date
    function parse() {
      var args;
      try { args = JSON.parse(ta.value); } catch (e) { msg.textContent = T.badJson + ": " + e.message; return null; }
      if (!args || typeof args !== "object" || Array.isArray(args)) { msg.textContent = T.badJson; return null; }
      return args;
    }
    function test() {
      var args = parse();
      if (!args) return;
      if (!window.hermes || !window.hermes.dataset || !window.hermes.dataset.test) { msg.textContent = T.noBridge; return; }
      msg.textContent = T.testing;
      tested = ta.value;
      window.hermes.dataset.test(id, args, params).then(function (r) {
        msg.textContent = r.status === "ok" ? T.testOk.replace("{n}", r.total != null ? r.total : "—").replace("{ms}", r.ms) : T.failed + ": " + (r.message || r.status);
        testOut.replaceChildren();
        if (r.status === "ok" && r.rows) testOut.appendChild(table({ columns: r.columns, rows: r.rows }, null));
        else if (r.status === "ok") testOut.appendChild(h("pre", { text: JSON.stringify(r.answer, null, 2).slice(0, 4000) }));
      }).catch(function (e) { msg.textContent = String(e && e.message || e); });
    }
    ta.addEventListener("input", function () { if (tested !== null && ta.value !== tested) { testOut.classList.add("stale"); msg.textContent = T.testStale; } });
    function showHistory() {
      if (!histBox.hidden) { histBox.hidden = true; return; }
      if (!window.hermes || !window.hermes.dataset || !window.hermes.dataset.history) { msg.textContent = T.noBridge; return; }
      window.hermes.dataset.history(id).then(function (entries) {
        histBox.replaceChildren(h("p", { "class": "src-meta", text: entries.length ? T.historyHint : T.historyNone }));
        entries.slice().reverse().forEach(function (e) {
          var same = JSON.stringify(e.args) === JSON.stringify(d.source.args || {});
          histBox.appendChild(h("button", { "class": "src-hist-row", type: "button", onclick: function () {
            ta.value = JSON.stringify(e.args, null, 2); msg.textContent = T.restored; ta.dispatchEvent(new Event("input"));
          } }, [h("span", { text: new Date(e.at * 1000).toLocaleString() }), h("span", { "class": "src-meta", text: (e.via === "agent" ? "Hermes" : e.via === "user" ? T.you : e.via) + (same ? " · " + T.current : "") })]));
        });
        histBox.hidden = false;
      }).catch(function (e) { msg.textContent = String(e && e.message || e); });
    }
    function save() {
      var args;
      try { args = JSON.parse(ta.value); } catch (e) { msg.textContent = T.badJson + ": " + e.message; return; }
      if (!args || typeof args !== "object" || Array.isArray(args)) { msg.textContent = T.badJson; return; }
      if (!window.hermes || !window.hermes.dataset || !window.hermes.dataset.edit) { msg.textContent = T.noBridge; return; }
      msg.textContent = T.saving;
      window.hermes.dataset.edit(id, args, C.version).then(function (r) {
        if (r && r.conflict) { msg.textContent = T.conflict; return; }
        C.version = r.version;
        d.source.args = args;
        editing = null;
        delete live[id];
        loadLive(id, true); // saved by the user, so already approved (unless approval is required)
        kit.toast(T.querySaved);
        renderSources();
      }).catch(function (e) { msg.textContent = String(e && e.message || e); });
    }
    ta.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); } });
    return h("div", {}, [ta, msg, h("div", { "class": "src-actions" }, [
      kit.labelled(kit.button(T.test, "play", test, T.test), T.test),
      kit.labelled(kit.button(T.save, "", save, T.save), T.save),
      kit.labelled(kit.button(T.history, "notes", showHistory, T.history), T.history),
      kit.labelled(kit.button(T.cancel, "", function () { editing = null; renderSources(); }, T.cancel), T.cancel)
    ]), histBox, testOut]);
  }

  function toggleSources(on) {
    srcOpen = on === undefined ? !srcOpen : on;
    if (srcOpen && !drawer) { drawer = h("aside", { "class": "kit-drawer dash-drawer", "aria-label": T.sources }); document.body.appendChild(drawer); }
    if (!srcOpen && drawer) { drawer.remove(); drawer = null; picked = null; }
    document.documentElement.setAttribute("data-dash-mode", srcOpen ? "data" : "page");
    srcBtn.setAttribute("aria-pressed", String(srcOpen));
    sendView();
    // As Claude's: the panel runs the frame's full height beside the page; the bar stops at its edge.
    var side = srcOpen && innerWidth > 900 ? "min(420px, 100%)" : "";
    document.getElementById("dash-main").style.marginRight = side;
    bar.style.marginRight = side;
    if (srcOpen) renderSources();
    redraw();
  }

  // In data mode a click on a marked element opens its source, the clicked cell lit.
  root.addEventListener("click", function (e) {
    if (!srcOpen) return;
    var m = e.target.closest && e.target.closest("[data-source]");
    if (!m) return;
    e.preventDefault(); e.stopPropagation();
    var ids = (m.getAttribute("data-source") || "").split(/\s+/).filter(Boolean);
    var where = (m.getAttribute("data-where") || "").split("&").filter(Boolean).map(function (kv) {
      var p = kv.split("="); return [decodeURIComponent(p[0]), decodeURIComponent(p.slice(1).join("="))];
    });
    var row = m.getAttribute("data-row");
    var cell = e.target.closest("td,th");
    var table = m.tagName === "TABLE" ? m : null;
    var field = m.getAttribute("data-field");
    if (table && cell) {
      var idx = Array.prototype.indexOf.call(cell.parentNode.children, cell);
      var th = table.querySelectorAll("th")[idx];
      field = th && th.getAttribute("data-field") || field;
      var key = table.getAttribute("data-row-key");
      var tr = cell.closest("tr");
      if (key && tr && tr.getAttribute("data-key") != null) where = [[key, tr.getAttribute("data-key")]];
    }
    root.querySelectorAll(".dash-picked").forEach(function (n) { n.classList.remove("dash-picked"); });
    m.classList.add("dash-picked");
    openSource(ids[0], { field: field, where: where.length ? where : null, row: row != null ? +row : null });
  }, true);

  function snapshot() {
    var doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll("script, #dash-bar, .kit-drawer, .kit-toast, .kit-menu").forEach(function (n) { n.remove(); });
    doc.removeAttribute("data-dash-mode");
    var head = doc.querySelector("head");
    head.insertBefore(h("meta", { "http-equiv": "Content-Security-Policy", content: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:" }), head.firstChild);
    var main = doc.querySelector("#dash-main");
    if (main) main.style.marginRight = "";
    var foot = h("p", { style: "margin:24px var(--dash-gutter,24px);font-size:12px;color:var(--color-fg-muted)",
      text: (C.title || "") + " · " + new Date().toLocaleString() + (L === "hu" ? " · a számok nem frissülnek" : " · numbers do not update") });
    (doc.querySelector("#dash-main") || doc.querySelector("body")).appendChild(foot);
    return "<!doctype html>\n" + doc.outerHTML;
  }

  function exportJson() {
    var out = { version: 1, title: C.title, exported_at: new Date().toISOString(), inputs: params, sources: [] };
    Object.keys(datasets).forEach(function (id) {
      var r = get(id), d = datasets[id];
      out.sources.push({ id: id, title: d.title || id, description: d.description || "", status: r.status,
        columns: r.columns || [], rows: r.rows || [], as_of: d.updated && d.updated.at || null });
    });
    out.html = kit.fileText((spec && spec.page) || "index.html");
    return JSON.stringify(out, null, 2);
  }

  // The same bar on every dashboard (the page below it is the agent's): refresh and how fresh the
  // numbers are on the left, the Sources panel on the right. Exports sit in the host's toolbar.
  var freshEl = h("span", { "class": "dash-fresh" });
  var srcBtn = kit.button("", "panel", function () { toggleSources(); }, T.sources);
  var exportList = [
    { id: "snapshot", label: T.snap, run: function () { kit.download(kit.slug(C.title) + ".html", snapshot(), "text/html"); } },
    { id: "json", label: T.json, run: function () { kit.download(kit.slug(C.title) + ".json", exportJson(), "application/json"); } }
  ].concat(Object.keys(datasets).map(function (id) {
    return { id: "csv:" + id, label: T.csvOf + ": " + (datasets[id].title || id),
      run: function () { kit.download(id + ".csv", toCsv(get(id)), "text/csv"); } };
  }));
  bar.className = "kit-bar dash-bar";
  bar.append(kit.button("", "refresh", function () { refreshLive(true); gen++; redraw(); }, T.refreshAll), freshEl,
    h("span", { style: "flex:1" }), srcBtn);
  kit.exports(exportList).then(function (hosted) {
    if (hosted) return;
    var own = kit.labelled(kit.button(T.exp, "download", function () {
      kit.menu(own, exportList.map(function (x) { return { label: x.label, onClick: x.run }; }));
    }), T.exp);
    bar.insertBefore(own, srcBtn);
  });

  function freshness() {
    var ids = Object.keys(datasets).filter(function (id) { return used[id]; });
    var busy = ids.some(function (id) { return live[id] && (live[id].running || live[id].status === "loading" || (live[id].cached && !live[id].revalidated && !C.thumb)); });
    if (busy) return T.refreshing;
    var times = ids.map(function (id) {
      if (live[id] && live[id].at) return live[id].at * 1000;
      var u = datasets[id].updated && datasets[id].updated.at;
      return u ? Date.parse(u) : null;
    }).filter(function (t) { return t && !isNaN(t); });
    if (!times.length) return "";
    var oldest = Math.min.apply(null, times), sec = (Date.now() - oldest) / 1000;
    return T.updatedAgo + " " + (sec < 60 ? T.now : ago(oldest));
  }
  function tickFresh() { freshEl.textContent = freshness(); }
  setInterval(tickFresh, 30000);

  // A source that failed (a connector down, a sign-in that expired) runs again when the viewer comes
  // back to the dashboard, at most every 5 s.
  var lastRetry = 0;
  function retryFailed() {
    if (Date.now() - lastRetry < 5000 || document.hidden) return;
    lastRetry = Date.now();
    liveIds().forEach(function (id) {
      var st = live[id];
      if (st && !st.running && /^(error|failed|reauth|absent|off)$/.test(st.status)) loadLive(id, false);
    });
  }
  window.addEventListener("focus", retryFailed);
  document.addEventListener("visibilitychange", retryFailed);

  // ------------------------------------------------------------------ view context (with the next chat message)
  function viewContext() {
    var place = kit.inView("#dash-root [id], #dash-root .c-h, #dash-root h1, #dash-root h2");
    var placeName = place ? (place.id || place.textContent.trim().slice(0, 60)) : null;
    var filters = {};
    Object.keys(params).forEach(function (k) {
      if (JSON.stringify(params[k]) !== JSON.stringify(paramDefaults[k])) filters[k] = params[k];
    });
    var failures = Object.keys(used).filter(function (id) {
      var s = statusOf(id).status;
      return /^(error|failed|reauth|absent|off|refused|missing)$/.test(s);
    });
    return { mode: srcOpen ? "data" : "page", place: placeName,
      selected: picked ? [picked.id] : [], field: picked && picked.field || null, filters: filters,
      failed: failures.length, failures: failures.slice(0, 5).map(function (id) { return { id: id, label: datasets[id] && datasets[id].title || id }; }) };
  }
  function sendView() { kit.view(viewContext); }
  window.addEventListener("scroll", sendView, { passive: true });

  // ------------------------------------------------------------------ check + runs (feedback to the agent)
  var checkTimer = null, lastSent = { check: "", runs: "" };
  function settled() {
    return Object.keys(used).every(function (id) {
      var st = live[id];
      return !st || !(st.running || st.status === "loading" || (st.cached && !st.revalidated));
    });
  }
  function statusOf(id) {
    var r = cache[id] && cache[id].r, lv = live[id] || {};
    if (!used[id]) return { status: "unused" };
    if (!r) return { status: "loading" };
    return { status: lv.status && lv.status !== "ok" && r.status !== "ok" ? lv.status : r.status, message: r.message || lv.message,
      rows: (r.rows || []).length, ms: lv.ms, at: lv.at, cached: lv.cached };
  }
  function rowsForCheck(id) {
    var v = view(id);
    if (v.rows.length) return v.rows;
    return v.value && typeof v.value === "object" && !Array.isArray(v.value) ? [v.value] : v.rows; // a calc's one value
  }
  /** The check as it stands, without sending it (for debugging a page). */
  window.dashCheckNow = function () {
    return window.dashCheck.run({ root: root, datasets: datasets, version: C.version, params: params,
      errors: Object.keys(errorLog).map(function (k) { return errorLog[k]; }), statusOf: statusOf, rowsOf: rowsForCheck });
  };
  function scheduleCheck() {
    if (C.thumb || !window.dashCheck || !window.hermes || !window.hermes.report) return;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(function () {
      if (!settled()) return scheduleCheck();
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        var out = window.dashCheck.run({ root: root, datasets: datasets, version: C.version, params: params,
          errors: Object.keys(errorLog).map(function (k) { return errorLog[k]; }),
          statusOf: statusOf, rowsOf: rowsForCheck });
        ["check", "runs"].forEach(function (kind) {
          var body = JSON.stringify(Object.assign({}, out[kind], { at: undefined }));
          if (body === lastSent[kind]) return;
          lastSent[kind] = body;
          window.hermes.report(kind, out[kind]).catch(function () {});
        });
      }); });
    }, 900);
  }

  // ------------------------------------------------------------------ approval banner
  var bannerEl = null, connEl = null;
  // A connector that's out (login expired, turned off, not connected): one line per server, with the
  // way back. The sources retry when the viewer returns to the dashboard.
  function connBanner() {
    var by = {};
    liveIds().forEach(function (id) {
      var st = live[id];
      if (!st || !/^(reauth|absent|off)$/.test(st.status)) return;
      var key = (st.server || datasets[id].source.tool) + "|" + st.status;
      (by[key] = by[key] || { server: st.server, status: st.status, message: st.message, ids: [] }).ids.push(id);
    });
    var list = Object.keys(by).map(function (k) { return by[k]; });
    if (!list.length || C.thumb) { if (connEl) { connEl.remove(); connEl = null; } return; }
    var box = h("div", { "class": "dash-ask dash-conn" }, list.map(function (c) {
      var title = c.status === "reauth" ? T.reauthTitle : c.status === "off" ? T.offTitle : T.absentTitle;
      return h("div", { "class": "dash-conn-row" }, [
        h("div", { style: "flex:1;min-width:0" }, [
          h("b", { text: title.replace("{s}", c.server || "MCP") }),
          h("p", { text: (c.status === "reauth" ? T.reauthBody : c.status === "off" ? T.offBody : T.absentBody) + " " +
            T.affected + ": " + c.ids.map(function (id) { return datasets[id].title || id; }).join(", ") })
        ]),
        kit.labelled(kit.button(c.status === "reauth" ? T.signIn : T.openConnectors, "data", function () {
          if (window.hermes && window.hermes.connectors) window.hermes.connectors(c.server || "").catch(function () {});
        }), c.status === "reauth" ? T.signIn : T.openConnectors),
        kit.labelled(kit.button(T.retry, "refresh", function () { c.ids.forEach(function (id) { loadLive(id, true); }); }), T.retry)
      ]);
    }));
    if (connEl) connEl.replaceWith(box); else root.parentNode.insertBefore(box, root);
    connEl = box;
  }
  function banner() {
    connBanner();
    var pending = liveIds().filter(function (id) { return live[id] && live[id].status === "approval"; });
    if (!pending.length || C.thumb) { if (bannerEl) { bannerEl.remove(); bannerEl = null; } return; }
    var tools = {};
    pending.forEach(function (id) { tools[live[id].tool || datasets[id].source.tool] = 1; });
    var box = h("div", { "class": "dash-ask" }, [
      h("b", { text: T.askTitle }),
      h("p", { text: T.askBody }),
      h("ul", {}, pending.map(function (id) {
        return h("li", {}, [h("code", { text: live[id].tool || datasets[id].source.tool }), " — " + (datasets[id].title || id)]);
      })),
      h("div", { "class": "src-actions" }, [
        kit.labelled(kit.button(T.allow, "data", function () {
          Promise.all(pending.map(function (id) { return window.hermes.dataset.approve(id, C.version); }))
            .then(function () { pending.forEach(function (id) { loadLive(id, true); }); })
            .catch(function (e) { kit.toast(String(e && e.message || e)); });
        }), T.allow),
        kit.labelled(kit.button(T.decline, "", function () {
          pending.forEach(function (id) { live[id].status = "declined"; window.hermes.dataset.decline(id, C.version).catch(function () {}); });
          gen++; redraw(); banner();
        }), T.decline)
      ])
    ]);
    if (bannerEl) bannerEl.replaceWith(box); else root.parentNode.insertBefore(box, root);
    bannerEl = box;
  }

  // ------------------------------------------------------------------ boot
  if (!spec) {
    root.appendChild(h("div", { "class": "dash-err", text: T.bad }));
    return;
  }
  var booted = false;
  function boot() {
    if (booted) return; booted = true;
    mount(); // a live source loads when the page first reads it (dash.data), as Claude's do
    redraw();
    kit.ready();
  }
  // Filters a viewer set last time (per artifact), then the page.
  if (window.hermes && !C.thumb) {
    var t = setTimeout(boot, 1200);
    window.hermes.storage.get("dash.params").then(function (p) {
      if (p && typeof p === "object") params = Object.assign({}, params, p);
    }).catch(function () {}).then(function () { clearTimeout(t); boot(); });
  } else boot();
})();
