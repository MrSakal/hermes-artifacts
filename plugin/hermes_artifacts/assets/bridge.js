/* Injected into every artifact page. Talks only to the parent shell over a MessagePort. */
(function () {
  if (window.hermes) return;
  var port = null, seq = 0, pending = new Map(), queue = [], failed = false, listeners = {};

  function call(op, args) {
    return new Promise(function (resolve, reject) {
      if (failed) return reject(new Error("hermes bridge unavailable (page not opened inside the artifact viewer)"));
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      var msg = { id: id, op: op, args: args || {} };
      port ? port.postMessage(msg) : queue.push(msg);
    });
  }
  function emit(event, detail) { // page -> host, no answer expected
    var msg = { event: event, detail: detail };
    port ? port.postMessage(msg) : queue.push(msg);
  }
  // An event that comes before anyone listens (the port can arrive while the page is still loading)
  // is kept, and the first listener for it gets the last one.
  var early = {};
  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    if (Object.prototype.hasOwnProperty.call(early, name)) {
      var d = early[name]; delete early[name];
      setTimeout(function () { try { fn(d); } catch (_) {} }, 0);
    }
  }

  window.addEventListener("message", function (e) {
    // Trust is by source: only our direct parent may hand us the port.
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.__hermes_bridge !== 1 || d.kind !== "port" || !e.ports[0]) return;
    port = e.ports[0];
    port.onmessage = function (ev) {
      var r = ev.data;
      if (r && r.event) {
        var ls = listeners[r.event];
        if (!ls || !ls.length) { early[r.event] = r.detail; return; }
        ls.forEach(function (fn) { try { fn(r.detail); } catch (_) {} });
        return;
      }
      var p = pending.get(r && r.id);
      if (!p) return;
      pending.delete(r.id);
      r.ok ? p.resolve(r.value) : p.reject(new Error(r.error || "bridge error"));
    };
    queue.splice(0).forEach(function (m) { port.postMessage(m); });
  });

  if (window.parent !== window) {
    // The hello carries no data, so "*" is safe; the reply is checked by source above.
    try { window.parent.postMessage({ __hermes_bridge: 1, kind: "hello", v: 2 }, "*"); } catch (_) {}
  }
  setTimeout(function () {
    if (port) return;
    failed = true;
    queue.splice(0).forEach(function (m) {
      var p = pending.get(m.id); pending.delete(m.id);
      p && p.reject(new Error("hermes bridge unavailable"));
    });
  }, 10000);

  // --- links to the artifact's other pages (multi-file artifacts) ---------------------------
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("[data-hermes-page]");
    if (!a || picking) return;
    e.preventDefault();
    call("navigate", { page: a.getAttribute("data-hermes-page") }).catch(function () {});
  }, true);

  // --- comments: the host turns pick mode on, the page reports the element clicked ----------
  var picking = false, hoverBox = null, pins = [];
  function selectorOf(el) {
    if (!el || el === document.body || el === document.documentElement) return "body";
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return "#" + el.id;
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 8) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift("#" + el.id); break; }
      var tag = el.tagName.toLowerCase(), i = 1, s = el;
      while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++;
      parts.unshift(tag + ":nth-of-type(" + i + ")");
      el = el.parentElement;
    }
    return parts.join(" > ");
  }
  function box(color) {
    var b = document.createElement("div");
    b.setAttribute("data-hermes-ui", "");
    b.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid " + color +
      ";border-radius:4px;background:" + color + "14;transition:all .06s";
    document.documentElement.appendChild(b);
    return b;
  }
  function place(b, el) {
    var r = el.getBoundingClientRect();
    b.style.left = r.left - 2 + "px"; b.style.top = r.top - 2 + "px";
    b.style.width = r.width + "px"; b.style.height = r.height + "px";
  }
  function onMove(e) {
    if (!picking) return;
    var el = e.target;
    if (!el || el.hasAttribute("data-hermes-ui")) return;
    hoverBox = hoverBox || box("#d97757");
    place(hoverBox, el);
  }
  function onPick(e) {
    if (!picking) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target, r = el.getBoundingClientRect();
    var text = (el.innerText || el.textContent || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ");
    emit("picked", { selector: selectorOf(el), text: text.slice(0, 200), label: el.tagName.toLowerCase(),
                     rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }
  function setPicking(on) {
    picking = !!on;
    document.documentElement.style.cursor = picking ? "crosshair" : "";
    if (picking) document.documentElement.setAttribute("data-commenting", "1"); else document.documentElement.removeAttribute("data-commenting");
    if (!picking && hoverBox) { hoverBox.remove(); hoverBox = null; }
  }
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onPick, true);
  on("comment-mode", function (d) { setPicking(d && d.on); });
  on("pins", function (items) { // [{selector, n}] numbered badges on commented elements
    pins.forEach(function (p) { p.remove(); }); pins = [];
    (items || []).forEach(function (it) {
      var el; try { el = document.querySelector(it.selector); } catch (_) {}
      if (!el) return;
      var r = el.getBoundingClientRect(), b = document.createElement("div");
      b.setAttribute("data-hermes-ui", "");
      b.textContent = String(it.n);
      b.style.cssText = "position:absolute;z-index:2147483645;min-width:18px;height:18px;padding:0 5px;" +
        "border-radius:9px;background:#d97757;color:#fff;font:600 11px/18px system-ui,sans-serif;" +
        "text-align:center;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.3)";
      b.style.left = r.right + window.scrollX - 9 + "px"; b.style.top = r.top + window.scrollY - 9 + "px";
      document.body.appendChild(b); pins.push(b);
    });
  });
  on("flash", function (d) {
    var el; try { el = document.querySelector(d && d.selector); } catch (_) {}
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    var b = box("#d97757"); place(b, el);
    setTimeout(function () { place(b, el); }, 350);
    setTimeout(function () { b.remove(); }, 1600);
  });

  window.hermes = Object.freeze({
    platform: "hermes-artifacts",
    version: 2,
    storage: Object.freeze({
      get: function (key) { return call("storage.get", { key: key }).then(function (r) { return r.value; }); },
      set: function (key, value) { return call("storage.set", { key: key, value: value }).then(function () {}); },
      remove: function (key) { return call("storage.set", { key: key, value: null }).then(function () {}); },
      list: function () { return call("storage.list").then(function (r) { return r.keys; }); }
    }),
    /** Send a message to the Hermes agent (lands in its artifact inbox / the chat). */
    /** Into the artifact's chat. By default it is put in the chat's message box for the user to send (Claude's
     *  stage_in_chat); {deliver: "send"} asks the user to confirm, then sends it. */
    send: function (text, data, opts) {
      return call("send", { text: String(text), data: data === undefined ? null : data, deliver: opts && opts.deliver === "send" ? "send" : "stage" });
    },
    /** Ask Hermes and wait for its answer: resolves with {text, data} once it replies. */
    ask: function (text, data) { return call("ask", { text: String(text), data: data === undefined ? null : data }); },
    /** Call an allowlisted Hermes tool (browser viewer only). */
    callTool: function (name, args) { return call("callTool", { name: name, args: args || {} }); },
    /** Download a file the page made: hermes.download("report.csv", text, "text/csv"). */
    download: function (name, content, type) {
      return call("download", { name: String(name), content: content, type: type || "application/octet-stream" });
    },
    /** Dashboards only: run a live dataset's stored call; approve/decline it (approve needs a click). */
    dataset: Object.freeze({
      run: function (id, params, force, version, mode) {
        return call("dataset.run", { id: String(id), params: params || {}, force: !!force, version: version || null,
          mode: mode === "cached" ? "cached" : "live" });
      },
      approve: function (id, version) { return call("dataset.approve", { id: String(id), version: version || null }); },
      decline: function (id, version) { return call("dataset.decline", { id: String(id), version: version || null }); },
      /** Sources' Test: run edited args without saving (needs a click). */
      test: function (id, args, params) { return call("dataset.test", { id: String(id), args: args, params: params || {} }); },
      /** A loader's call(tool, args): another tool of the dataset's own connector. */
      call: function (id, tool, args, version) { return call("dataset.call", { id: String(id), tool: String(tool), args: args || {}, version: version }); },
      /** Sources' history of a live query's args. */
      history: function (id) { return call("dataset.history", { id: String(id) }).then(function (r) { return r.entries; }); },
      /** The user editing a live query in Sources: new args for that dataset, saved as a new version. */
      edit: function (id, args, baseVersion) { return call("dataset.edit", { id: String(id), args: args, base_version: baseVersion || null }); }
    }),
    /** Design systems: get(id, version) one to build on (none: the default one; {none: true} when there is none;
     *  version: the one the artifact was built on, else the latest);
     *  makeDefault(on) from a design system's own page. */
    ds: Object.freeze({
      get: function (id, version) { return call("ds.get", { id: id || null, version: typeof version === "number" ? version : null }); },
      makeDefault: function (on) { return call("ds.default", { on: on !== false }); }
    }),
    /** Docs: the live doc on the server (read a tab, edit blocks, ask Hermes in the doc). */
    doc: Object.freeze({
      read: function (tab, sinceRev) { return call("doc.read", { tab: tab || null, since_rev: sinceRev == null ? null : sinceRev }); },
      edit: function (tab, ops, baseRev) { return call("doc.edit", { tab: tab || null, ops: ops, base_rev: baseRev == null ? null : baseRev }); },
      ask: function (a) { return call("doc.ask", a || {}); },
      history: function (tab) { return call("doc.history", { tab: tab || null }); },
      at: function (tab, rev) { return call("doc.at", { tab: tab || null, rev: rev }); },
      restore: function (tab, rev) { return call("doc.restore", { tab: tab || null, rev: rev }); }
    }),
    /** History (Claude's): the versions, one version's changes, Restore (needs a click), and showing a
     *  version in place (null = the latest). */
    history: Object.freeze({
      list: function () { return call("history.list", {}).then(function (r) { return r.versions; }); },
      diff: function (v) { return call("history.diff", { version: v }); },
      restore: function (v) { return call("history.restore", { version: v }); },
      show: function (v, panel) { return call("showVersion", { version: v == null ? null : v, panel: panel || null }); }
    }),
    /** Full screen for the artifact (the host fills the window; Esc leaves). */
    fullscreen: function (on) { return call("present", { on: on !== false }); },
    /** Start a comment on a part of the page (the host opens its comment form there). */
    comment: function (anchor) { emit("comment", anchor || {}); },
    /** Type runtimes only: a vendored export library's source text (loaded on demand). */
    vendor: function (name) { return call("vendor", { name: String(name) }).then(function (r) { return r.text; }); },
    /** Type runtimes only (slides, doc): save edited files as a new version. */
    save: function (files, baseVersion) { return call("save", { files: files, base_version: baseVersion || null }); },
    /** Type runtimes: tell the host which exports to offer in its toolbar ([{id, label}]); the host
     *  then sends an "export" event with the id the user picked. */
    chrome: function (opts) { return call("chrome", opts || {}); },
    /** Type runtimes: where the user is in the page (sent along with their next chat message). */
    view: function (context) { return call("view", { context: context || {} }); },
    /** Type runtimes: report what the page found ("check") and how its sources ran ("runs"). */
    report: function (kind, data) { return call("report", { kind: String(kind), data: data || {} }); },
    /** Dashboards: open Hermes' Connectors page at a server, to sign in again or turn it on. */
    connectors: function (server) { return call("connectors", { server: server ? String(server) : "" }); },
    /** Slides: present full screen (the host makes the frame fill the window and goes full screen). */
    present: function (on) { return call("present", { on: !!on }); },
    /** Host events for type runtimes (e.g. "theme"). */
    on: on
  });
})();
