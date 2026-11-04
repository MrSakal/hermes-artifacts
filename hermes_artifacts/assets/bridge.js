/* Injected into every artifact page. Talks only to the parent shell over a MessagePort. */
(function () {
  if (window.hermes) return;
  var port = null, seq = 0, pending = new Map(), queue = [], failed = false;

  function call(op, args) {
    return new Promise(function (resolve, reject) {
      if (failed) return reject(new Error("hermes bridge unavailable (page not opened inside the artifact viewer)"));
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      var msg = { id: id, op: op, args: args || {} };
      port ? port.postMessage(msg) : queue.push(msg);
    });
  }

  window.addEventListener("message", function (e) {
    // Host is either the browser shell (SHELL) or the Hermes Desktop pane (renderer origin varies),
    // so trust is by source: only our direct parent may hand us the port. Framing itself is
    // restricted by the content server's frame-ancestors.
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.__hermes_bridge !== 1 || d.kind !== "port" || !e.ports[0]) return;
    port = e.ports[0];
    port.onmessage = function (ev) {
      var r = ev.data, p = pending.get(r && r.id);
      if (!p) return;
      pending.delete(r.id);
      r.ok ? p.resolve(r.value) : p.reject(new Error(r.error || "bridge error"));
    };
    queue.splice(0).forEach(function (m) { port.postMessage(m); });
  });

  if (window.parent !== window) {
    // The hello carries no data, so "*" is safe; the reply is checked by source above.
    try { window.parent.postMessage({ __hermes_bridge: 1, kind: "hello", v: 1 }, "*"); } catch (_) {}
  }
  setTimeout(function () {
    if (port) return;
    failed = true;
    queue.splice(0).forEach(function (m) {
      var p = pending.get(m.id); pending.delete(m.id);
      p && p.reject(new Error("hermes bridge unavailable"));
    });
  }, 10000);

  window.hermes = Object.freeze({
    platform: "hermes-artifacts",
    version: 1,
    storage: Object.freeze({
      get: function (key) { return call("storage.get", { key: key }).then(function (r) { return r.value; }); },
      set: function (key, value) { return call("storage.set", { key: key, value: value }).then(function () {}); },
      remove: function (key) { return call("storage.set", { key: key, value: null }).then(function () {}); },
      list: function () { return call("storage.list").then(function (r) { return r.keys; }); }
    }),
    /** Send a message to the Hermes agent (lands in its artifact inbox / wakes the chat). */
    send: function (text, data) { return call("send", { text: String(text), data: data === undefined ? null : data }); },
    /** Call an allowlisted Hermes tool. */
    callTool: function (name, args) { return call("callTool", { name: name, args: args || {} }); }
  });
})();
