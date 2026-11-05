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
  function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }

  window.addEventListener("message", function (e) {
    // Trust is by source: only our direct parent may hand us the port.
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.__hermes_bridge !== 1 || d.kind !== "port" || !e.ports[0]) return;
    port = e.ports[0];
    port.onmessage = function (ev) {
      var r = ev.data;
      if (r && r.event) { (listeners[r.event] || []).forEach(function (fn) { try { fn(r.detail); } catch (_) {} }); return; }
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
    send: function (text, data) { return call("send", { text: String(text), data: data === undefined ? null : data }); },
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
      run: function (id, params, force, version) {
        return call("dataset.run", { id: String(id), params: params || {}, force: !!force, version: version || null });
      },
      approve: function (id, version) { return call("dataset.approve", { id: String(id), version: version || null }); },
      decline: function (id, version) { return call("dataset.decline", { id: String(id), version: version || null }); },
      /** The user editing a live query in Sources: new args for that dataset, saved as a new version. */
      edit: function (id, args, baseVersion) { return call("dataset.edit", { id: String(id), args: args, base_version: baseVersion || null }); }
    }),
    /** Type runtimes only: a vendored export library's source text (loaded on demand). */
    vendor: function (name) { return call("vendor", { name: String(name) }).then(function (r) { return r.text; }); },
    /** Type runtimes only (slides, doc): save edited files as a new version. */
    save: function (files, baseVersion) { return call("save", { files: files, base_version: baseVersion || null }); },
    /** Type runtimes: tell the host which exports to offer in its toolbar ([{id, label}]); the host
     *  then sends an "export" event with the id the user picked. */
    chrome: function (opts) { return call("chrome", opts || {}); },
    /** Dashboards: open Hermes' Connectors page at a server, to sign in again or turn it on. */
    connectors: function (server) { return call("connectors", { server: server ? String(server) : "" }); },
    /** Slides: present full screen (the host makes the frame fill the window and goes full screen). */
    present: function (on) { return call("present", { on: !!on }); },
    /** Host events for type runtimes (e.g. "theme"). */
    on: on
  });
})();
