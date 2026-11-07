(function () {
  var B = window.__HERMES_BOOT__ || {};
  var frame = document.getElementById("frame");
  if (!frame || !B.id) return;
  var sel = document.getElementById("ver");
  var status = document.getElementById("status");
  var current = B.v;

  function src(v) { return B.content + "/c/" + encodeURIComponent(B.id) + "/v" + v + "/index.html"; }
  function load(v) { current = v; frame.src = src(v) + "#t=" + Date.now(); }
  function flash(t) { status.textContent = t; clearTimeout(flash.t); flash.t = setTimeout(function () { status.textContent = ""; }, 2500); }

  // Bridge: artifact says hello -> hand it a fresh MessagePort, proxy ops to /api.
  window.addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || d.__hermes_bridge !== 1 || d.kind !== "hello") return;
    var ch = new MessageChannel();
    ch.port1.onmessage = function (ev) {
      var m = ev.data || {};
      fetch("/api/" + encodeURIComponent(B.id) + "/" + encodeURIComponent(m.op), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes-Token": B.token },
        body: JSON.stringify(m.args || {})
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (x) {
        ch.port1.postMessage(x.ok ? { id: m.id, ok: true, value: x.j } : { id: m.id, ok: false, error: x.j.error });
        if (x.ok && m.op === "send") flash(x.j.delivered ? "Sent to Hermes" : "Saved to the inbox");
      }).catch(function (err) {
        ch.port1.postMessage({ id: m.id, ok: false, error: String(err) });
      });
    };
    // Opaque (sandboxed) origin: targetOrigin must be "*"; the port is bound to this frame only.
    frame.contentWindow.postMessage({ __hermes_bridge: 1, kind: "port", v: 1 }, "*", [ch.port2]);
  });

  sel.addEventListener("change", function () {
    var v = +sel.value;
    history.replaceState(null, "", v === B.latest ? "/a/" + B.id : "/a/" + B.id + "?v=" + v);
    B.pinned = v !== B.latest;
    load(v);
  });
  document.getElementById("reload").addEventListener("click", function () { load(current); });

  // Live reload on republish (unless the viewer pinned an older version).
  var es = new EventSource("/events/" + encodeURIComponent(B.id));
  es.addEventListener("version", function (e) {
    var d = JSON.parse(e.data);
    if (d.v <= B.latest) return;
    B.latest = d.v;
    var o = document.createElement("option");
    o.value = d.v; o.textContent = "v" + d.v;
    sel.insertBefore(o, sel.firstChild);
    if (d.title) document.querySelector(".title").textContent = d.title;
    if (!B.pinned) { sel.value = d.v; load(d.v); flash("New version: v" + d.v); }
  });

  load(current);
})();
