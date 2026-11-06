/* Dev helper: an in-page stand-in for the Hermes bridge's save / send / download (render_preview.py
   --mock-slides), to try the slide editor without Hermes. window.__mock holds what the page did. */
(function () {
  var v = JSON.parse(document.getElementById("hermes-artifact-content").textContent).version, listeners = {};
  var m = window.__mock = { saves: [], sent: [], downloads: [] };
  function later(x) { return new Promise(function (r) { setTimeout(function () { r(x); }, 30); }); }
  window.hermes = {
    save: function (files, base) { m.saves.push({ files: files, base: base }); if (base !== v) return later({ ok: false, conflict: true }); v++; return later({ ok: true, version: v }); },
    send: function (text, data) { m.sent.push({ text: text, data: data }); return later({ ok: true }); },
    download: function (name, data) { m.downloads.push({ name: name, data: data }); return later({ ok: true }); },
    on: function (n, f) { (listeners[n] = listeners[n] || []).push(f); },
    view: function (ctx) { m.view = ctx; return later({ ok: true }); }
  };
})();
