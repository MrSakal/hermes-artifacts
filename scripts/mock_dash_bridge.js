/* Dev helper: an in-page stand-in for the Hermes bridge on a dashboard (render_preview.py --mock-dash),
   to try live sources without Hermes. Every live source answers with window.__mockAnswers[id] (set
   before load) or a few made-up report rows. window.__mock holds what the page did. */
(function () {
  var v = JSON.parse(document.getElementById("hermes-artifact-content").textContent).version, store = {};
  var m = window.__mock = { runs: [], edits: [], sent: [], downloads: [], reports: [] };
  function later(x, ms) { return new Promise(function (r) { setTimeout(function () { r(x); }, ms || 30); }); }
  function rows(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push({ id: 155 - i, date: "2026-10-" + String(1 + (i % 28)).padStart(2, "0"), author: "Tóth Gábor",
      description: "Titan Build: " + (3 + (i % 3)) + " fő, 8 óra; Metalstructur: " + (2 + (i % 4)) + " fő" });
    return out;
  }
  window.hermes = {
    save: function (files, base) { v++; return later({ ok: true, version: v }); },
    send: function (text, data) { m.sent.push({ text: text, data: data }); return later({ ok: true }); },
    download: function (name, data) { m.downloads.push({ name: name, data: data }); return later({ ok: true }); },
    on: function () {},
    view: function (ctx) { m.view = ctx; return later({ ok: true }); },
    chrome: function () { return later({ ok: false }); },
    report: function (kind, body) { m.reports.push({ kind: kind, body: body }); return later({ ok: true }); },
    storage: { get: function (k) { return later(store[k]); }, set: function (k, x) { store[k] = x; return later({ ok: true }); } },
    dataset: {
      run: function (id, params) {
        m.runs.push({ id: id, params: params });
        var a = (window.__mockAnswers || {})[id];
        return later({ status: "ok", answer: a !== undefined ? a : { reports: rows(103) }, at: Date.now() / 1000, ms: 412,
          server: "nodu ERP", tool: "list_project_reports" }, 300);
      },
      test: function (id, args) { return later({ status: "ok", rows: rows(3), columns: ["id", "date", "author", "description"], total: 3, ms: 120 }); },
      edit: function (id, args, base) { m.edits.push({ id: id, args: args }); v++; return later({ ok: true, version: v }); },
      history: function () { return later([]); },
      approve: function () { return later({ ok: true }); },
      decline: function () { return later({ ok: true }); }
    }
  };
})();
