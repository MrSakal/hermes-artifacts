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
  var L = "en"; // English only
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
      historyNone: "No earlier versions yet.", restored: "Earlier version in the editor. Nothing changes until you save.", you: "You", current: "current", cut: "Rows missing: the answer stopped short of all its rows.",
      history: "History", hAuto: "Versions are saved automatically as the dashboard is edited.", hNone: "Earlier versions of this dashboard will appear here.",
      hCantRead: "History can’t be read right now. Try again.", loading: "Loading…", hCurrent: "current version", hCreated: "Created the page",
      hRestored: "Restored the {when} version", hNoChange: "No changes", hAdded: "Added {name}", hRemoved: "Removed {name}", hEditedX: "Edited {name}",
      hEditedPage: "Edited the page", hEditedFilters: "Edited the filters", hEditedTitle: "Edited the title", hEditedLook: "Edited the look",
      hEditedSources: "Edited {n} sources", hEditedFiles: "Edited {n} files", hThePage: "the page", hNSources: "{n} sources", hTheFilters: "the filters",
      hTheTitle: "the title", hTheLook: "the look", hNFiles: "{n} files", hEditedMany: "Edited {things}", and: "and",
      backToHistory: "Back to History", hIsNow: "This is the dashboard as it is now.", hRestore: "Restore", hRestoredToast: "Restored.",
      hRestoreHint: "Restore makes this the dashboard again, as a new version; the versions after it stay in History.",
      hKAdded: "added", hKRemoved: "removed", hKEdited: "edited", hTooMuch: "Too much changed to show line by line.", hDraftAsked: "Asked for a draft", hDraftWrote: "Wrote the draft", hDraftDone: "Saved or discarded a draft",
      hEarlier: "Showing an earlier version with today’s data.", hBackLatest: "Back to latest", fullScreen: "Full screen", exitFull: "Exit full screen",
      askAbout: "Ask Hermes", aboutSel: "About this on the dashboard", staged: "Added to your message to Hermes. Send it when you’re ready.",
      testIt: "Test without saving", testResult: "Test result", replaceFile: "Replace with a file…", chooseFile: "Choose a .csv, .tsv or .json file.",
      fileNoRows: "The file has no rows this dashboard can read.", fileReady: "{name}: {n} rows. Save puts it in place of {old}.", saveFile: "Save",
      fileSaved: "File replaced.", fileTooBig: "The file is too large to attach. Choose a smaller one.",
      design: "Design", look: "Look", lookHint: "Colors, type and corners for the whole dashboard, in light and dark.", defaultLook: "Default look",
      designSystem: "Design system", customLook: "Custom look", lookSaved: "Look saved.", dsUnreadable: "That design system couldn’t be read.",
      editPage: "Edit the page", editHint: "Change the page’s words by hand, move or delete cards. Every change saves automatically.",
      newDraft: "New draft", draftHint: "Pick a format for a new draft. Nothing changes until you save.", draftWaiting: "A draft is waiting: save or cancel it first.",
      fmt_dashboard: "Dashboard", fmtd_dashboard: "Cards, figures and charts to watch at a glance.",
      "fmt_scrollyteller": "Scrollyteller", "fmtd_scrollyteller": "A finding told as you scroll, beside one chart that stays in view.",
      "fmt_visual-analysis": "Visual analysis", "fmtd_visual-analysis": "A finding read top to bottom, a chart under each heading.",
      "fmt_visual-short": "Visual short", "fmtd_visual-short": "A minute or two that plays: chapters on one stage, with captions.",
      draftMsg: "[draft request drafts/{id}] Remake this dashboard as a {format} draft. Read the “Drafts” section of the dashboard guide first (artifact_guide type=dashboard). Write the whole new page as drafts/{id}/index.html, with any .css or .js beside it, with artifact_publish id={aid} base=true files={…}; the draft reads the dashboard’s sources by id, a new or changed source goes whole into drafts/{id}/datasets.json and changed filter defaults into drafts/{id}/params.json. Leave the dashboard’s own files as they are: Save on the page copies the draft over them.",
      draftMaking: "Hermes is making your {format} draft. Nothing changes until you save it.", draftShowing: "Showing the draft. Nothing changes until you save.",
      draftAsIs: "The dashboard as it is. Press Redo to see the draft again.", draftUndo: "Undo", draftRedo: "Redo", draftCancel: "Cancel", draftSave: "Save",
      draftSaved: "The draft is now the dashboard.", draftCancelled: "Draft discarded",
      editorMode: "Editor mode", editEvery: "Every change saves automatically.", editSaving: "Saving…", editSaved: "Saved automatically",
      editFailed: "Autosave failed — retrying.", editConflict: "This dashboard changed meanwhile: press Done, then edit again.",
      editDone: "Done editing", editWritten: "The page writes this, so it can’t be edited. You can delete its card, or ask Hermes to change it.",
      editEarlier: "Move card earlier", editLater: "Move card later", editDelete: "Delete card", editDeleted: "Card deleted. Undo brings it back.",
      editFirst: "It is first already.", editLast: "It is last already.", editNothingUndo: "Nothing to undo", editNothingRedo: "Nothing to redo",
      editLatestFirst: "Go back to the latest version to edit.", editNeedsPage: "This dashboard is drawn from its layout. Asked Hermes to make it editable by hand.",
      editAskMsg: "Rewrite this dashboard’s page so it can be edited by hand: an index.html whose words are in the HTML and whose figures and charts are dash.draw drawings (read the dashboard guide’s “Editing by hand” section). Keep what it shows and how it looks.",
      didntLoad: "Didn’t load", didntRun: "Didn’t run", unusedTag: "Unused", whyNot: "Why didn’t this load?", whyNotRun: "Why didn’t this run?",
      errorSaid: "What the error said", copyError: "Copy the error", askFix: "Ask Hermes to fix", retryAll: "Retry all",
      someFailed: "Some sources failed to load.", someStale: "Some saved numbers are stale.", seeSources: "See sources", askWhy: "Ask Hermes why",
      backTo: "Back to {s}", hint: "Click a number or a chart to see its source.", nothingUses: "Nothing on this dashboard uses this source.",
      fixMsg: "This dashboard's source “{t}” ({id}) didn’t load. What it said: {m}. Find out why and fix it.",
      whyMsg: "These sources on this dashboard didn’t load: {list}. Find out why and fix what you can.", loaderSpent: "The loader ran for fifteen minutes, so no further call is made.",
      back: "Back", close: "Close", justNow: "Just now", copy: "Copy", copied: "Copied", expand: "Expand", downloadCsv: "Download CSV",
      showMore: "Show more", showLess: "Show less", transform: "Transform", row1: "row", noSources: "This dashboard has no sources.", noArgs: "No arguments." }
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
    if (raw.status === "ok" && loaders[id]) raw = loaded(id, raw);
    return raw;
  }

  // ------------------------------------------------------------------ loaders (Claude's dash.loader)
  // fn({answer, call, args, read}) may be async: `call(tool, args)` runs another tool of the dataset's
  // connector, `read` has the ready-made readers. It returns rows, {columns, rows, cut} or
  // {data, columns, meta}; throwing fails the source with its words. One identical call follows
  // another at least a second after it began; no call starts after fifteen minutes.
  var loads = {};
  function loadKey(id) {
    var st = live[id];
    return st ? "live:" + (st.at || 0) + ":" + (st.cached ? 1 : 0) + ":" + JSON.stringify(st.args || null).length : "file";
  }
  function asLoaded(out) {
    if (out && typeof out === "object" && !Array.isArray(out) && (Array.isArray(out.data) || Array.isArray(out.rows))) {
      var rows = Array.isArray(out.data) ? out.data : out.rows;
      var t = asTable(rows);
      if (Array.isArray(out.columns) && out.columns.length) t.columns = out.columns.map(String);
      return Object.assign({ status: "ok", meta: Array.isArray(out.meta) ? out.meta : [], cut: !!out.cut }, t);
    }
    if (Array.isArray(out)) return Object.assign({ status: "ok", meta: [] }, asTable(out));
    return Object.assign({ status: "ok", meta: [] }, asTable(out));
  }
  function loaded(id, raw) {
    var L = loaders[id], key = loadKey(id), rec = loads[id];
    if (rec && rec.key === key && rec.fn === L.fn) return rec.result || { status: "loading" };
    rec = loads[id] = { key: key, fn: L.fn, result: null, calls: [] };
    var st = live[id];
    var answer = st && st.answer !== undefined ? st.answer : raw.value !== undefined ? raw.value : raw.rows;
    var args = (st && st.args) || (datasets[id] && datasets[id].source && datasets[id].source.args) || {};
    var started = Date.now(), last = null;
    var call = async function (tool, a) {
      if (Date.now() - started > 15 * 60 * 1000) throw new Error(T.loaderSpent);
      if (!window.hermes || !window.hermes.dataset || !window.hermes.dataset.call) throw new Error(T.noBridge);
      var sig = String(tool) + JSON.stringify(a || {});
      if (last && last.sig === sig) { var wait = 1000 - (Date.now() - last.at); if (wait > 0) await new Promise(function (r) { setTimeout(r, wait); }); }
      last = { sig: sig, at: Date.now() };
      var r = await window.hermes.dataset.call(id, tool, a || {}, C.version);
      rec.calls.push({ tool: String(tool), ms: r.ms || 0, ok: r.status === "ok" });
      if (r.status !== "ok") throw new Error(r.message || r.status);
      return r.answer;
    };
    var ctx = { answer: answer, call: call, args: JSON.parse(JSON.stringify(args)), rows: raw.rows, columns: raw.columns,
      params: JSON.parse(JSON.stringify(params)) };
    ctx.read = window.dashReads ? window.dashReads({ call: call, args: ctx.args }) : {};
    var done = function (result) {
      if (loads[id] !== rec) return;
      rec.result = result; gen++; redraw();
    };
    try {
      var out = L.fn(ctx);
      if (!out || typeof out.then !== "function") { rec.result = asLoaded(out); return rec.result; }
      out.then(function (v) { done(asLoaded(v)); }, function (e) {
        done({ status: "error", message: String(e && e.message || e), meta: e && Array.isArray(e.meta) ? e.meta : [], loaderFailed: true });
      });
    } catch (e) {
      rec.result = { status: "error", message: String(e && e.message || e), meta: e && Array.isArray(e.meta) ? e.meta : [], loaderFailed: true };
      return rec.result;
    }
    return { status: "loading" };
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
      value: r.value, cut: !!r.cut };
  }

  var scheduled = false;
  var drawFns = {};
  /** Each data-draw="name" holds only its current state; one under [hidden] isn't run (or loaded). */
  function runDraws(only) {
    Object.keys(drawFns).forEach(function (name) {
      if (only && only !== name) return;
      var d = drawFns[name];
      root.querySelectorAll('[data-draw="' + CSS.escape(name) + '"]').forEach(function (el) {
        if (el.closest("[hidden]")) return;
        try {
          if (typeof d === "function") d(el);
          else {
            if (!el.__made) { el.replaceChildren(); el.__made = { v: d.mount ? d.mount(el) : undefined }; }
            if (d.update) d.update(el, el.__made.v);
          }
        } catch (e) {
          pageError(e, d.__file);
          if (typeof d !== "function" && d.unmount && el.__made) { try { d.unmount(el, el.__made.v); } catch (x) {} }
          el.__made = null;
        }
      });
    });
  }
  function redraw() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      drawers.forEach(run);
      runDraws();
      stamp();
      if (typeof failNotice === "function") failNotice();
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
    draw: function (name, fn) {
      name = String(name);
      if (fn === undefined) { runDraws(name); return; }
      if (typeof fn !== "function" && !(fn && typeof fn === "object")) return;
      fn.__file = currentFile; drawFns[name] = fn; gen++; redraw();
    },
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
      return new Intl.NumberFormat(undefined, o || { maximumFractionDigits: 1 }).format(+n);
    }
  };
  window.dash = dash;

  function saveParams() {
    if (window.hermes) window.hermes.storage.set("dash.params", params).catch(function () {});
  }

  // ------------------------------------------------------------------ marks
  function stampRoot() {
    var ids = Object.keys(used), any = false, loading = false, bad = false;
    ids.forEach(function (id) { var r = cache[id] && cache[id].r; if (!r) return; any = true; if (r.status === "loading") loading = true; else if (r.status !== "ok") bad = true; });
    var st = loading ? "loading" : bad ? "error" : "";
    if (st) root.setAttribute("data-dash-state", st); else root.removeAttribute("data-dash-state");
  }
  function stamp() {
    stampRoot();
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
    if (showingDraft()) { mountHtml(kit.fileText(draft.page), draft.page, root); return; } // a draft is the whole page
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
    var foot = [tools, body, h("div", { "class": "src-count", text: rows.length + " " + (rows.length === 1 ? T.row1 : T.rowsN) })];
    if (r.cut) foot.push(h("p", { "class": "src-warn", style: "margin:6px 0 0", text: T.cut }));
    return foot.concat(metaView(id, r.meta));
  }
  /** What the loader returned beside the rows (the SQL that ran, the job): under Result, code copyable. */
  function metaView(id, list) {
    if (!Array.isArray(list) || !list.length) return [];
    return [h("div", { "class": "src-meta-list" }, list.slice(0, 12).map(function (m, i) {
      var v = m && m.value != null ? String(m.value) : "";
      return h("div", { "class": "src-meta-row" }, [h("div", { "class": "src-kv-k", text: String(m && m.label || "") }),
        m && m.type === "code" ? codeBlock(id + ":m" + i, v) : h("div", { "class": "src-kv-v", text: v })]);
    }))];
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
      kit.labelled(kit.button(T.testIt, "play", function () {
        if (!window.hermes || !window.hermes.dataset || !window.hermes.dataset.test) { kit.toast(T.noBridge); return; }
        argTest[id] = { running: true };
        renderSources();
        window.hermes.dataset.test(id, draft, params).then(function (r) { argTest[id] = r; renderSources(); },
          function (e) { argTest[id] = { status: "error", message: String(e && e.message || e) }; renderSources(); });
      }, T.testIt), T.testIt),
      kit.labelled(kit.button(T.save, "", function () { saveArgs(id, d, draft); }, T.save), T.save),
      kit.labelled(kit.button(T.cancel, "", function () { delete argDraft[id]; renderSources(); }, T.cancel), T.cancel)
    ]));
    var tr = argTest[id];
    if (changed && tr) {
      kids.push(h("div", { "class": "src-kv-k", style: "margin-top:12px", text: T.testResult }));
      if (tr.running) kids.push(h("p", { "class": "src-meta", text: T.testing }));
      else if (tr.status !== "ok") kids.push(h("p", { "class": "src-warn", style: "margin:4px 0", text: T.failed + ": " + (tr.message || tr.status) }));
      else if (tr.rows) kids.push(table({ columns: tr.columns, rows: tr.rows }, null));
      else kids.push(codeBlock(id + ":test", JSON.stringify(tr.answer, null, 2).slice(0, 4000)));
    }
    return kids;
  }
  var argDraft = {}, argTest = {};
  /** Claude's "Replace with a file…": a CSV, TSV or JSON in place of an attached file, saved as a new version. */
  var picks = {};
  function replaceFile(id, d) {
    var inp = h("input", { type: "file", accept: ".csv,.tsv,.json,text/csv,application/json", hidden: true });
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { picks[id] = { error: T.fileTooBig }; renderSources(); return; }
      var ext = (f.name.match(/\.(csv|tsv|json)$/i) || [])[1];
      if (!ext) { picks[id] = { error: T.chooseFile }; renderSources(); return; }
      f.text().then(function (text) {
        var t;
        try { t = ext.toLowerCase() === "json" ? asTable(JSON.parse(text)) : parseDelimited(text, ext.toLowerCase() === "tsv" ? "\t" : ","); } catch (e) { t = null; }
        picks[id] = t && (t.rows || []).length ? { name: f.name, ext: ext.toLowerCase(), text: text, n: t.rows.length } : { error: T.fileNoRows };
        renderSources();
      });
    });
    var kids = [inp, h("div", { "class": "src-actions" }, [kit.labelled(kit.button(T.replaceFile, "file", function () { inp.click(); }), T.replaceFile)])];
    var p = picks[id];
    if (p && p.error) kids.push(h("p", { "class": "src-warn", style: "margin:6px 0 0", text: p.error }));
    if (p && p.text) {
      kids.push(h("p", { "class": "src-meta", style: "margin:8px 0 0", text: T.fileReady.replace("{name}", p.name).replace("{n}", p.n).replace("{old}", d.source.path) }));
      kids.push(h("div", { "class": "src-actions" }, [kit.labelled(kit.button(T.saveFile, "", function () {
        var path = String(d.source.path).replace(/\.(csv|tsv|json)$/i, "") + "." + p.ext;
        var next = JSON.parse(JSON.stringify(spec));
        next.datasets[id].source.path = path;
        if (p.ext !== "csv") next.datasets[id].source.format = p.ext; else delete next.datasets[id].source.format;
        next.datasets[id].updated = { at: new Date().toISOString(), by: "user" };
        var files = { "dashboard.json": JSON.stringify(next, null, 2) };
        files[path] = p.text;
        if (path !== d.source.path) files[d.source.path] = null;
        window.hermes.save(files, C.version).then(function (r) {
          if (r && r.conflict) { kit.toast(T.conflict); return; }
          delete picks[id]; kit.toast(T.fileSaved);
          if (window.hermes.history) window.hermes.history.show(null, "sources");
        }, function (e) { kit.toast(String(e && e.message || e)); });
      }, T.saveFile), T.saveFile)]));
    }
    return kids;
  }
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
      var unused = !calcs[id] && !used[id] && !marked(id);
      return h("button", { "class": "src-li", type: "button", onclick: function () { openSource(id); } }, [
        h("span", { "class": "src-li-t", text: sourceTitle(id) }),
        bad ? h("span", { "class": "src-tag bad", title: r.message || r.status, text: calcs[id] ? T.didntRun : T.didntLoad }) : unused ? h("span", { "class": "src-tag", text: T.unusedTag }) : null,
        h("span", { "class": "src-kind", html: kit.icon(kindIcon(id)) })
      ]);
    }));
    var failedIds = ids.filter(function (id) { var r = cache[id] && cache[id].r; return r && /^(error|failed|refused|missing)$/.test(r.status) && isLive(datasets[id] || {}); });
    return [head, ids.length ? h("p", { "class": "src-hint", text: T.hint }) : null,
      failedIds.length ? h("div", { "class": "src-actions", style: "margin:0 16px 6px" }, [kit.labelled(kit.button(T.retryAll, "refresh", function () {
        failedIds.forEach(function (id) { loadLive(id, true); }); renderSources();
      }), T.retryAll)]) : null,
      ids.length ? list : h("p", { "class": "src-empty", text: T.noSources })];
  }

  function renderDetail(id) {
    var isCalc = !!calcs[id] && !datasets[id];
    var d = isCalc ? calcs[id] : datasets[id];
    if (!d) { picked = null; return renderList(); }
    var r = cache[id] ? cache[id].r : get(id);
    var lv = !isCalc && isLive(d) ? live[id] || {} : null;
    if (openSec[id] === undefined) openSec[id] = isCalc ? "formula" : lv ? "query" : "result";
    var head = h("div", { "class": "src-head" }, [
      iconBtn("prev", T.backTo.replace("{s}", trail.length ? sourceTitle(trail[trail.length - 1]) : T.sources), function () {
        var back = trail.pop();
        if (back) { picked = { id: back }; renderSources(); return; }
        picked = null; root.querySelectorAll(".dash-picked").forEach(function (n) { n.classList.remove("dash-picked"); }); renderSources();
      }),
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
    if (r.status !== "ok" && r.status !== "loading") {
      var said = String(r.message || r.status);
      warn.push(h("div", { "class": "src-fail" }, [
        h("b", { text: isCalc ? T.whyNotRun : T.whyNot }),
        h("div", { "class": "src-kv-k", style: "margin-top:6px", text: T.errorSaid }),
        codeBlock(id + ":e", said),
        h("div", { "class": "src-actions" }, [
          kit.labelled(kit.button(T.askFix, "sparkle", function () {
            if (window.hermes && window.hermes.send) window.hermes.send(T.fixMsg.replace("{t}", sourceTitle(id)).replace("{id}", id).replace("{m}", said.slice(0, 600)), { dataset: id, failed: true }).catch(function () {});
          }), T.askFix),
          kit.labelled(kit.button(T.copyError, "copy", function () { copyText(said); }), T.copyError),
          lv ? kit.labelled(kit.button(T.retry, "refresh", function () { loadLive(id, true); renderSources(); }), T.retry) : null
        ].filter(Boolean))
      ]));
    }
    if (!isCalc && isStale(d)) warn.push(h("p", { "class": "src-warn", text: T.stale + (d.schedule ? " · " + d.schedule : "") }));
    if (!isCalc && !marked(id)) warn.push(h("p", { "class": "src-meta", text: used[id] ? T.notmarked : T.nothingUses }));
    var secs = [];
    if (lv) secs.push(section(id, "query", T.query, function () { return editing === id ? [queryEditor(id, d)] : argInputs(id, d); }));
    if (!isCalc && d.source && d.source.kind === "file") secs.push(section(id, "file", T.file, function () {
      return [h("p", { "class": "src-tool" }, [h("code", { text: d.source.path || "" })])].concat(replaceFile(id, d));
    }));
    var tf = !isCalc && transformOf(id, d);
    if (tf) secs.push(section(id, "transform", T.transform, function () {
      return [tf.desc ? h("p", { "class": "src-desc", text: tf.desc }) : null, codeBlock(id + ":t", tf.code)];
    }));
    if (isCalc) secs.push(section(id, "formula", T.formula, function () {
      return [h("div", { "class": "src-inputs" }, d.inputs.map(function (k) {
        return h("button", { "class": "src-li", type: "button", onclick: function () { openSource(k, null, true); } },
          [h("span", { "class": "src-li-t", text: sourceTitle(k) }), h("span", { "class": "src-kind", html: kit.icon(kindIcon(k)) })]);
      })), codeBlock(id + ":f", String(d.fn))];
    }));
    secs.push(section(id, "result", T.preview, function () { return resultView(id, r, false); }));
    return [head, h("div", { "class": "src-detail" }, [top].concat(warn, secs))];
  }

  var trail = [];
  function openSource(id, hit, fromDetail) {
    if (fromDetail && picked && picked.id !== id) trail.push(picked.id); else if (!fromDetail) trail = [];
    picked = Object.assign({ id: id }, hit || {});
    if (hit && (hit.field || hit.where || hit.row != null)) openSec[id] = "result";
    renderSources();
    if (drawer) drawer.scrollTop = 0;
  }

  function renderSources() {
    if (!drawer) return;
    if (panelMode !== "sources") return renderPanel();
    drawer.replaceChildren.apply(drawer, (picked ? renderDetail(picked.id) : renderList()).filter(Boolean));
  }
  // ------------------------------------------------------------------ History (Claude's, inside the dashboard)
  var panelMode = "sources", histPicked = null, histList = null, histDiff = {}, histOpen = {}, latestVersion = C.version;
  var shownVersion = C.version;
  function whenText(at) {
    if (!at) return "";
    var d = new Date(at * 1000), s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return T.justNow;
    if (s < 86400 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString(L, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString(L, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(L, { hour: "2-digit", minute: "2-digit" });
  }
  function summaryText(sm, versions) {
    if (!sm) return "";
    if (sm.what === "created") return T.hCreated;
    if (sm.what === "restored") {
      var v = (versions || []).filter(function (x) { return x.n === sm.restored; })[0];
      var d = v && v.at ? new Date(v.at * 1000) : null;
      return T.hRestored.replace("{when}", d ? d.toLocaleDateString(L, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(L, { hour: "2-digit", minute: "2-digit" }) : "v" + sm.restored);
    }
    var th = sm.things || [];
    if (!th.length) return T.hNoChange;
    if (th.length === 1) {
      var t = th[0];
      if (t.t === "source") return (t.kind === "added" ? T.hAdded : t.kind === "removed" ? T.hRemoved : T.hEditedX).replace("{name}", t.name);
      if (t.t === "page") return T.hEditedPage;
      if (t.t === "filters") return T.hEditedFilters;
      if (t.t === "title") return T.hEditedTitle;
      if (t.t === "look") return T.hEditedLook;
      if (t.t === "draft") return t.kind === "added" ? T.hDraftAsked : t.kind === "removed" ? T.hDraftDone : T.hDraftWrote;
      if (t.t === "sources") return T.hEditedSources.replace("{n}", t.n);
      if (t.t === "files") return t.name ? T.hEditedX.replace("{name}", t.name) : T.hEditedFiles.replace("{n}", t.n);
    }
    var names = th.map(function (t) {
      return t.t === "page" ? T.hThePage : t.t === "source" ? t.name : t.t === "sources" ? T.hNSources.replace("{n}", t.n)
        : t.t === "filters" ? T.hTheFilters : t.t === "title" ? T.hTheTitle : t.t === "look" ? T.hTheLook : T.hNFiles.replace("{n}", t.n);
    });
    return T.hEditedMany.replace("{things}", names.slice(0, -1).join(", ") + " " + T.and + " " + names[names.length - 1]);
  }
  function loadHistory() {
    if (!window.hermes || !window.hermes.history) { histList = []; renderPanel(); return; }
    window.hermes.history.list().then(function (v) { histList = v || []; renderPanel(); }, function () { histList = null; renderPanel(T.hCantRead); });
  }
  function renderHistory(err) {
    var head = h("div", { "class": "src-head" }, [h("b", { text: T.history }), iconBtn("close", T.close, function () { toggleHistory(false); })]);
    if (err) return [head, h("p", { "class": "src-empty", text: err })];
    if (histList === null) return [head, h("p", { "class": "src-empty", text: T.loading })];
    if (histPicked !== null) return renderVersion(histPicked);
    var rows = histList.map(function (v) {
      return h("button", { "class": "src-li dash-version-row" + (v.n === shownVersion ? " picked" : ""), type: "button", onclick: function () { openVersion(v.n); } }, [
        h("span", { style: "flex:1;min-width:0;display:flex;flex-direction:column;gap:2px" }, [
          h("span", { "class": "src-li-t", text: whenText(v.at) + (v.current ? " · " + T.hCurrent : "") }),
          h("span", { "class": "src-tool", text: (v.by === "user" ? T.you : "Hermes") + " · " + summaryText(v.summary, histList) })
        ])
      ]);
    });
    return [head, h("p", { "class": "src-hint", text: T.hAuto }), histList.length ? h("div", { "class": "src-list" }, rows) : h("p", { "class": "src-empty", text: T.hNone })];
  }
  function openVersion(n) {
    histPicked = n;
    if (n !== shownVersion && window.hermes && window.hermes.history) { window.hermes.history.show(n === latestVersion ? null : n, "history"); return; }
    renderPanel();
  }
  function renderVersion(n) {
    var v = (histList || []).filter(function (x) { return x.n === n; })[0] || { n: n };
    var head = h("div", { "class": "src-head" }, [
      iconBtn("prev", T.backToHistory, function () { histPicked = null; renderPanel(); }),
      h("span", { style: "flex:1" }),
      iconBtn("close", T.close, function () { toggleHistory(false); })
    ]);
    var top = h("div", { "class": "src-top" }, [
      h("b", { "class": "src-title", text: whenText(v.at) }),
      h("p", { "class": "src-desc", text: (v.by === "user" ? T.you : "Hermes") + " · " + summaryText(v.summary, histList) }),
      v.current ? h("p", { "class": "src-meta", style: "margin:6px 0 0", text: T.hIsNow }) : h("div", { "class": "src-actions" }, [
        kit.labelled(kit.button(T.hRestore, "undo", function () {
          window.hermes.history.restore(n).then(function () { kit.toast(T.hRestoredToast); window.hermes.history.show(null, "history"); },
            function (e) { kit.toast(String(e && e.message || e)); });
        }), T.hRestore)
      ]),
      v.current ? null : h("p", { "class": "src-meta", style: "margin:8px 0 0", text: T.hRestoreHint })
    ]);
    var d = histDiff[n];
    if (d === undefined && window.hermes && window.hermes.history) {
      histDiff[n] = null;
      window.hermes.history.diff(n).then(function (r) { histDiff[n] = r; renderPanel(); }, function () { histDiff[n] = { changes: [], failed: true }; renderPanel(); });
    }
    var body = !d ? [h("p", { "class": "src-empty", text: T.loading })] : !d.changes.length ? [h("p", { "class": "src-empty", text: d.failed ? T.hCantRead : T.hNoChange })] : d.changes.map(function (c, i) {
      var key = n + ":" + i, open = !!histOpen[key];
      var label = c.name + ": " + (c.kind === "added" ? T.hKAdded : c.kind === "removed" ? T.hKRemoved : T.hKEdited) +
        (c.lines ? " · +" + c.added + " −" + c.removed : "");
      return h("div", { "class": "src-sec2" + (open ? " open" : "") }, [
        h("button", { "class": "src-sec2-head", type: "button", onclick: function () { histOpen[key] = !open; renderPanel(); } },
          [h("span", { style: "font-size:13.5px", text: label }), h("span", { "class": "src-caret", html: kit.icon(open ? "caretDown" : "caretRight") })]),
        open ? h("div", { "class": "src-sec2-body" }, [c.lines ? h("pre", { "class": "dash-diff" }, c.lines.map(function (ln) {
          return h("span", { "class": ln[0] === "+" ? "add" : ln[0] === "-" ? "del" : ln.slice(0, 2) === "@@" ? "hunk" : "", text: ln + "\n" });
        })) : h("p", { "class": "src-meta", text: T.hTooMuch })]) : null
      ]);
    });
    return [head, h("div", { "class": "src-detail" }, [top].concat(body))];
  }
  function renderPanel(err) {
    if (!drawer) return;
    var kids = panelMode === "history" ? renderHistory(err) : panelMode === "design" && window.dashDesign ? window.dashDesign.render() : picked ? renderDetail(picked.id) : renderList();
    drawer.replaceChildren.apply(drawer, kids.filter(Boolean));
  }
  function toggleHistory(on) {
    var open = on === undefined ? !(srcOpen && panelMode === "history") : on;
    if (!open) { panelMode = "sources"; toggleSources(false); return; }
    panelMode = "history"; histList = null;
    toggleSources(true, true);
    loadHistory();
  }
  // An earlier version shows with today's data, and says so.
  var verBar = null;
  function versionBar() {
    var old = shownVersion !== latestVersion;
    if (!old || C.thumb) { if (verBar) { verBar.remove(); verBar = null; } return; }
    var box = h("div", { "class": "dash-notice dash-version-bar" }, [
      h("span", { style: "flex:1;min-width:0", text: T.hEarlier }),
      kit.labelled(kit.button(T.hBackLatest, "refresh", function () { window.hermes.history.show(null, panelMode === "history" && srcOpen ? "history" : null); }), T.hBackLatest)
    ]);
    if (verBar) verBar.replaceWith(box); else root.parentNode.insertBefore(box, root);
    verBar = box;
  }
  if (window.hermes && window.hermes.on) {
    window.hermes.on("versions", function (d) {
      if (d && typeof d.latest === "number") latestVersion = d.latest;
      if (d && typeof d.shown === "number") shownVersion = d.shown;
      versionBar();
    });
    window.hermes.on("open-panel", function (d) {
      if (!d) return;
      if (d.panel === "history") { histPicked = d.version == null ? null : d.version; toggleHistory(true); }
      else if (d.panel === "design" && window.dashDesign) window.dashDesign.open();
    });
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

  function toggleSources(on, keepMode) {
    var want = on === undefined ? !(srcOpen && panelMode === "sources") : on;
    if (!keepMode && want) panelMode = "sources";
    srcOpen = want;
    if (!srcOpen) panelMode = "sources";
    if (srcOpen && !drawer) { drawer = h("aside", { "class": "kit-drawer dash-drawer", "aria-label": T.sources }); document.body.appendChild(drawer); }
    if (!srcOpen && drawer) { drawer.remove(); drawer = null; picked = null; }
    document.documentElement.setAttribute("data-dash-mode", srcOpen && panelMode === "sources" ? "data" : "page");
    srcBtn.setAttribute("aria-pressed", String(srcOpen && panelMode === "sources"));
    histBtn.setAttribute("aria-pressed", String(srcOpen && panelMode === "history"));
    if (window.dashDesign) window.dashDesign.pressed(srcOpen && panelMode === "design");
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
    if (!srcOpen || panelMode !== "sources") return;
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
      text: (C.title || "") + " · " + new Date().toLocaleString() + " · numbers do not update" });
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
  var histBtn = kit.button("", "history", function () { toggleHistory(); }, T.history);
  var full = false;
  var fullBtn = kit.button("", "expand", function () {
    full = !full;
    if (window.hermes && window.hermes.fullscreen) window.hermes.fullscreen(full).catch(function () {});
    fullBtn.setAttribute("aria-pressed", String(full)); fullBtn.title = full ? T.exitFull : T.fullScreen;
  }, T.fullScreen);
  if (window.hermes && window.hermes.on) window.hermes.on("present-exit", function () { full = false; fullBtn.setAttribute("aria-pressed", "false"); fullBtn.title = T.fullScreen; });
  bar.append(kit.button("", "refresh", function () { refreshLive(true); gen++; redraw(); }, T.refreshAll), freshEl,
    h("span", { style: "flex:1" }), histBtn, fullBtn, srcBtn);
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

  // ------------------------------------------------------------------ select text, then Ask Hermes
  var askBtn = null;
  function hideAsk() { if (askBtn) { askBtn.remove(); askBtn = null; } }
  document.addEventListener("mouseup", function (e) {
    if (askBtn && askBtn.contains(e.target)) return;
    setTimeout(function () {
      hideAsk();
      if (C.thumb || (srcOpen && panelMode === "sources") || document.documentElement.getAttribute("data-dash-editing") === "1") return;
      var sel = window.getSelection(), text = sel ? String(sel).trim() : "";
      if (!text || text.length > 800 || !sel.rangeCount) return;
      var range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      var r = range.getBoundingClientRect();
      var near = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      var place = near && near.closest ? near.closest("[id]") : null;
      if (place === root || (place && !root.contains(place))) place = null;
      askBtn = h("button", { "class": "dash-ask-sel", type: "button", style: "left:" + Math.max(8, Math.min(r.left, innerWidth - 180)) + "px;top:" + Math.max(8, r.top - 40) + "px",
        html: kit.icon("sparkle") + "<span>" + kit.esc(T.askAbout) + "</span>" });
      askBtn.addEventListener("click", function () {
        var msg = T.aboutSel + (place && place.id ? " (#" + place.id + ")" : "") + ": \u201c" + text.slice(0, 600) + "\u201d\n";
        if (window.hermes && window.hermes.send) window.hermes.send(msg, { selection: text.slice(0, 600), place: place && place.id || null })
          .then(function () { kit.toast(T.staged); }, function () {});
        hideAsk();
        try { window.getSelection().removeAllRanges(); } catch (err) {}
      });
      document.body.appendChild(askBtn);
    }, 0);
  });
  window.addEventListener("scroll", hideAsk, { passive: true });

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
  var noticeEl = null, noticeDismissed = "";
  function failNotice() {
    var failedIds = Object.keys(used).filter(function (id) {
      var r = cache[id] && cache[id].r;
      return datasets[id] && r && /^(error|failed|refused|missing)$/.test(r.status);
    });
    var staleIds = Object.keys(used).filter(function (id) { return datasets[id] && isStale(datasets[id]); });
    var key = failedIds.join(",") + "|" + staleIds.join(",");
    if (C.thumb || (!failedIds.length && !staleIds.length) || key === noticeDismissed) { if (noticeEl) { noticeEl.remove(); noticeEl = null; } return; }
    var box = h("div", { "class": "dash-notice" + (failedIds.length ? " bad" : "") }, [
      h("span", { style: "flex:1;min-width:0", text: failedIds.length ? T.someFailed : T.someStale }),
      kit.labelled(kit.button(T.seeSources, "panel", function () { toggleSources(true); if (failedIds.length === 1) openSource(failedIds[0]); }), T.seeSources),
      failedIds.length ? kit.labelled(kit.button(T.askWhy, "sparkle", function () {
        var list = failedIds.map(function (id) { var r = cache[id].r; return "“" + sourceTitle(id) + "” (" + id + "): " + String(r.message || r.status).slice(0, 200); }).join("; ");
        if (window.hermes && window.hermes.send) window.hermes.send(T.whyMsg.replace("{list}", list), { datasets: failedIds }).catch(function () {});
      }), T.askWhy) : null,
      kit.button("", "close", function () { noticeDismissed = key; failNotice(); }, T.close)
    ].filter(Boolean));
    if (noticeEl) noticeEl.replaceWith(box); else root.parentNode.insertBefore(box, root);
    noticeEl = box;
  }
  function banner() {
    connBanner();
    failNotice();
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

  // ------------------------------------------------------------------ Design: the look, drafts, Edit the page
  var DK = window.dashDesignKit || null;
  var draft = DK ? DK.draftOf(kit.content.files) : null;
  var draftView = "draft"; // "draft" | "dashboard": Undo / Redo between the draft and the dashboard as it is
  var showingDraft = function () { return !!(draft && draft.page && draftView === "draft"); };
  if (DK && spec && spec.look) DK.wear(spec.look);
  var designBtn = kit.button("", "palette", function () { toggleDesign(); }, T.design);
  function toggleDesign(on) {
    var open = on === undefined ? !(srcOpen && panelMode === "design") : on;
    if (!open) { panelMode = "sources"; toggleSources(false); return; }
    panelMode = "design";
    toggleSources(true, true);
  }
  var design = DK ? DK.init({ T: T, spec: spec, iconBtn: iconBtn, isOpen: function () { return srcOpen && panelMode === "design"; },
    render: function () { renderPanel(); }, close: function () { toggleDesign(false); }, draft: function () { return draft; },
    edit: function () { toggleDesign(false); if (window.dashEdit) window.dashEdit.start(); } }) : null;
  window.dashDesign = { render: function () { return design ? design.render() : []; }, open: function () { toggleDesign(true); },
    pressed: function (on) { designBtn.setAttribute("aria-pressed", String(!!on)); } };

  var draftBar = null;
  function saveDraft() {
    var files = DK.saveDraftFiles(kit.content.files, spec, draft);
    window.hermes.save(files, C.version).then(function (r) {
      if (r && r.conflict) { kit.toast(T.conflict); return; }
      kit.toast(T.draftSaved);
      window.hermes.history.show(null, null);
    }, function (e) { kit.toast(String(e && e.message || e)); });
  }
  function cancelDraft() {
    var files = {};
    DK.draftFiles(kit.content.files, draft).forEach(function (p) { files[p] = null; });
    window.hermes.save(files, C.version).then(function (r) {
      if (r && r.conflict) { kit.toast(T.conflict); return; }
      kit.toast(T.draftCancelled);
      window.hermes.history.show(null, null);
    }, function (e) { kit.toast(String(e && e.message || e)); });
  }
  function setDraftView(v) {
    draftView = v;
    if (window.hermes && window.hermes.storage) window.hermes.storage.set("dash.draftView." + draft.id, v).catch(function () {});
    window.hermes.history.show(null, null);
  }
  function showDraftBar() {
    if (!draft || C.thumb) return;
    var kids;
    if (!draft.page) kids = [h("span", { style: "flex:1;min-width:0", text: T.draftMaking.replace("{format}", T["fmt_" + draft.format]) }),
      kit.labelled(kit.button(T.draftCancel, "close", cancelDraft), T.draftCancel)];
    else kids = [h("span", { style: "flex:1;min-width:0", text: showingDraft() ? T.draftShowing : T.draftAsIs }),
      showingDraft() ? kit.labelled(kit.button(T.draftUndo, "undo", function () { setDraftView("dashboard"); }), T.draftUndo)
        : kit.labelled(kit.button(T.draftRedo, "redo", function () { setDraftView("draft"); }), T.draftRedo),
      kit.labelled(kit.button(T.draftCancel, "close", cancelDraft), T.draftCancel),
      kit.labelled(kit.button(T.draftSave, "", saveDraft), T.draftSave)];
    var box = h("div", { "class": "dash-notice dash-draft-bar" }, kids);
    if (draftBar) draftBar.replaceWith(box); else root.parentNode.insertBefore(box, root);
    draftBar = box;
  }
  if (!C.thumb) {
    var spacer = bar.querySelector("span[style*='flex:1']");
    if (spacer && spacer.nextSibling) bar.insertBefore(designBtn, spacer.nextSibling);
  }

  function remount(html) {
    document.querySelectorAll("style[data-page]").forEach(function (n) { n.remove(); });
    drawers.length = 0; drawFns = {};
    root.replaceChildren();
    mountHtml(html, editPath() || "index.html", root);
    gen++; redraw();
  }
  function editPath() {
    if (showingDraft()) return draft.page;
    if (spec && Array.isArray(spec.layout)) return null; // drawn from its layout: Hermes rewrites it to be edited by hand
    var p = (spec && spec.page) || "index.html";
    return kit.fileText(p) != null ? p : null;
  }
  window.dashEdit = window.dashEditKit ? window.dashEditKit.init({ T: T, root: root, remount: remount, redraw: function () { gen++; redraw(); },
    pagePath: editPath, isLatest: function () { return shownVersion === latestVersion; } }) : null;

  // ------------------------------------------------------------------ boot
  if (!spec) {
    root.appendChild(h("div", { "class": "dash-err", text: T.bad }));
    return;
  }
  var booted = false;
  function boot() {
    if (booted) return; booted = true;
    if (showingDraft()) {
      // A draft reads the dashboard's sources by id; a new or changed one is in its datasets.json.
      try { Object.assign(datasets, JSON.parse(kit.fileText("drafts/" + draft.id + "/datasets.json") || "{}")); } catch (e) {}
      try { var dp = JSON.parse(kit.fileText("drafts/" + draft.id + "/params.json") || "null"); if (dp && typeof dp === "object") { paramDefaults = dp; params = Object.assign({}, dp, params); } } catch (e) {}
    }
    showDraftBar();
    mount(); // a live source loads when the page first reads it (dash.data), as Claude's do
    redraw();
    kit.ready();
  }
  // Filters a viewer set last time (per artifact), then the page.
  if (window.hermes && !C.thumb) {
    var t = setTimeout(boot, 1200);
    Promise.all([window.hermes.storage.get("dash.params").catch(function () {}),
      draft ? window.hermes.storage.get("dash.draftView." + draft.id).catch(function () {}) : null]).then(function (r) {
      var p = r[0];
      if (p && typeof p === "object") params = Object.assign({}, params, p);
      if (r[1] === "dashboard" || r[1] === "draft") draftView = r[1];
    }).catch(function () {}).then(function () { clearTimeout(t); boot(); });
  } else boot();
})();
