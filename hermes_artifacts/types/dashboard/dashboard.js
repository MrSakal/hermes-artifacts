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
      save: "Save", cancel: "Cancel", saving: "Saving…", badJson: "Not valid JSON", conflict: "Changed meanwhile: reload first", querySaved: "Query saved" },
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
      save: "Mentés", cancel: "Mégse", saving: "Mentés…", badJson: "Nem érvényes JSON", conflict: "Közben megváltozott: előbb töltsd újra", querySaved: "Lekérdezés elmentve" }
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
    }
  }

  // ------------------------------------------------------------------ page
  var DROP = "script,link,meta,base,form,iframe,frame,frameset,object,embed,portal";
  function pageError(e, file) {
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

  window.addEventListener("error", function (e) { if (e.filename && e.filename.indexOf("dash-page/") >= 0) pageError(e.error || e.message, e.filename.split("dash-page/")[1]); });

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

  function table(r, hit) {
    var cols = r.columns && r.columns.length ? r.columns : Object.keys((r.rows || [])[0] || {});
    var t = h("table");
    t.appendChild(h("tr", {}, cols.map(function (c) { return h("th", { "class": hit && hit.field === c ? "hit" : null, text: c }); })));
    (r.rows || []).slice(0, 200).forEach(function (o, i) {
      var rowHit = hit && (hit.row === i || (hit.where && hit.where.every(function (kv) { return String(o[kv[0]]) === kv[1]; })));
      t.appendChild(h("tr", {}, cols.map(function (c) {
        var v = o[c];
        return h("td", { "class": rowHit && (!hit.field || hit.field === c) ? "hit" : null, text: v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v) });
      })));
    });
    return h("div", { "class": "src-table" }, [t]);
  }

  function marked(id) { return !!root.querySelector('[data-source~="' + CSS.escape(id) + '"]'); }

  function renderSources() {
    if (!drawer) return;
    drawer.replaceChildren();
    drawer.appendChild(h("div", { "class": "src-head" }, [h("b", { text: T.sources }),
      kit.button("", "close", function () { toggleSources(false); }, "Close")]));
    var ids = Object.keys(datasets);
    if (ids.length) drawer.appendChild(h("div", { "class": "src-sec", text: T.sources + " · " + ids.length }));
    ids.forEach(function (id) { drawer.appendChild(item(id, datasets[id], false)); });
    var cids = Object.keys(calcs);
    if (cids.length) drawer.appendChild(h("div", { "class": "src-sec", text: T.calc }));
    cids.forEach(function (id) { drawer.appendChild(item(id, calcs[id], true)); });
    var pk = Object.keys(params);
    if (pk.length) {
      drawer.appendChild(h("div", { "class": "src-sec", text: T.params }));
      drawer.appendChild(h("div", { "class": "src-body" }, [h("pre", { text: JSON.stringify(params, null, 2) })]));
    }
    var pickedEl = drawer.querySelector(".src-item.picked");
    if (pickedEl) pickedEl.scrollIntoView({ block: "nearest" });
  }

  function item(id, d, isCalc) {
    var r = cache[id] ? cache[id].r : get(id);
    var open = picked && picked.id === id;
    var stale = !isCalc && isStale(d);
    var lv = !isCalc && isLive(d) ? live[id] || {} : null;
    var kind = isCalc ? T.calc : lv ? T.live + " · " + (d.source.tool || "") : d.source && d.source.kind === "file" ? T.file + " · " + (d.source.path || "") : T.rows;
    var isValue = r.status === "ok" && r.value !== undefined && !(r.rows || []).length;
    var meta = [kind, r.status !== "ok" ? r.status : isValue ? T.value : (r.rows || []).length + " " + T.rowsN];
    if (lv && lv.at) meta.push(T.ago + " " + ago(lv.at) + (lv.cached ? " · " + T.cached : "") + (lv.running ? " · " + T.refreshing : ""));
    else if (!isCalc && d.updated && d.updated.at) meta.push(T.updated + " " + ago(d.updated.at));
    var dot = lv && (lv.running || lv.status === "loading") ? "loading" : lv && lv.status === "approval" ? "loading" : stale ? "stale" : r.status;
    var body = null;
    if (open) {
      var kids = [];
      if (d.description) kids.push(h("p", { text: d.description }));
      if (stale) kids.push(h("p", { "class": "src-warn", text: T.stale + (d.schedule ? " · " + d.schedule : "") }));
      if (r.status !== "ok") kids.push(h("p", { "class": "src-warn", text: T.failed + ": " + (r.message || r.status) }));
      if (lv) {
        kids.push(h("p", { "class": "src-meta", text: T.query + " · " + (d.source.tool || "") + (lv.ms != null ? " · " + T.took + " " + lv.ms + " ms" : "") }));
        kids.push(h("pre", { text: JSON.stringify(lv.args || d.source.args || {}, null, 2) }));
        if (editing === id) kids.push(queryEditor(id, d));
        else kids.push(h("div", { "class": "src-actions" }, [
          kit.labelled(kit.button(T.refresh, "refresh", function () { loadLive(id, true); renderSources(); }, T.refreshSrc), T.refresh),
          kit.labelled(kit.button(T.editQuery, "notes", function () { editing = id; renderSources(); }, T.editQuery), T.editQuery)
        ]));
      }
      if (isCalc) kids.push(h("p", { text: T.formula + " (" + d.inputs.join(", ") + ")" }), h("pre", { text: String(d.fn) }));
      if (!isCalc && loaders[id]) kids.push(h("p", { text: loaders[id].description || "loader" }), h("pre", { text: String(loaders[id].fn) }));
      if (!marked(id) && !isCalc) kids.push(h("p", { "class": "src-meta", text: used[id] ? T.notmarked : T.unused }));
      if (r.status === "ok" && (r.rows || []).length) kids.push(table(r, picked));
      else if (r.status === "ok" && r.value !== undefined) kids.push(h("pre", { text: JSON.stringify(r.value, null, 2) }));
      if (r.status === "ok" && (r.rows || []).length) {
        kids.push(h("div", { "class": "src-actions" }, [kit.labelled(kit.button("CSV", "download", function () {
          kit.download(id + ".csv", toCsv(r), "text/csv"); kit.toast(T.saved);
        }), "CSV")]));
      }
      body = h("div", { "class": "src-body" }, kids);
    }
    return h("div", { "class": "src-item" + (open ? " picked" : "") }, [
      h("button", { "class": "src-row", type: "button", onclick: function () { picked = open ? null : { id: id }; renderSources(); } }, [
        h("span", { "class": "src-dot " + dot }),
        h("span", { style: "flex:1;min-width:0" }, [h("div", { text: d.title || id }), h("div", { "class": "src-meta", text: meta.join(" · ") })]),
        h("span", { "class": "src-kind", title: kind, html: kit.icon(isCalc ? "braces" : lv ? "data" : d.source && d.source.kind === "file" ? "file" : "braces") })
      ]),
      body
    ]);
  }

  var editing = null;
  function queryEditor(id, d) {
    var ta = h("textarea", { "class": "src-edit", spellcheck: "false", rows: "10" });
    ta.value = JSON.stringify(d.source.args || {}, null, 2);
    var msg = h("p", { "class": "src-meta", text: T.editHint });
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
      kit.labelled(kit.button(T.save, "", save, T.save), T.save),
      kit.labelled(kit.button(T.cancel, "", function () { editing = null; renderSources(); }, T.cancel), T.cancel)
    ])]);
  }

  function toggleSources(on) {
    srcOpen = on === undefined ? !srcOpen : on;
    if (srcOpen && !drawer) { drawer = h("aside", { "class": "kit-drawer" }); document.body.appendChild(drawer); }
    if (!srcOpen && drawer) { drawer.remove(); drawer = null; picked = null; }
    document.documentElement.setAttribute("data-dash-mode", srcOpen ? "data" : "page");
    srcBtn.setAttribute("aria-pressed", String(srcOpen));
    document.getElementById("dash-main").style.marginRight = srcOpen && innerWidth > 900 ? "min(420px, 100%)" : "";
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
    picked = { id: ids[0], field: field, where: where.length ? where : null, row: row != null ? +row : null };
    renderSources();
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
