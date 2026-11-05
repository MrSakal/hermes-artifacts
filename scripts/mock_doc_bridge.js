/* Dev helper: an in-page stand-in for the Hermes bridge's doc ops (render_preview.py --mock-doc).
   window.__mock.hermesEdit(ops) plays Hermes editing the doc. */
(function () {
  var C = JSON.parse(document.getElementById("hermes-artifact-content").textContent);
  var tabs = C.doc.tabs, log = [], n = 0, listeners = {};
  function id(p) { return p + "-m" + (++n); }
  function split(md) { return String(md).split(/\n\s*\n/).filter(function (s) { return s.trim(); }); }
  function tabOf(t) { return tabs.find(function (x) { return x.id === t; }) || tabs[0]; }
  function idx(t, b) { return t.blocks.findIndex(function (x) { return x.id === b; }); }
  function apply(t, ops, by) {
    t = tabOf(t); var changed = [], newTab = null;
    ops.forEach(function (o) {
      if (o.op === "replace") { var i = idx(t, o.block), p = split(o.md); if (!p.length) p = [""]; t.blocks[i].md = p[0];
        var ex = p.slice(1).map(function (m) { return { id: id("b"), md: m }; }); t.blocks.splice.apply(t.blocks, [i + 1, 0].concat(ex));
        changed.push(o.block); ex.forEach(function (b) { changed.push(b.id); }); }
      if (o.op === "insert") { var at = o.after ? idx(t, o.after) + 1 : 0, nb = (split(o.md).length ? split(o.md) : [""]).map(function (m) { return { id: id("b"), md: m }; });
        t.blocks.splice.apply(t.blocks, [at, 0].concat(nb)); nb.forEach(function (b) { changed.push(b.id); }); }
      if (o.op === "delete") { t.blocks.splice(idx(t, o.block), 1); changed.push(o.block); }
      if (o.op === "add_tab") { newTab = { id: id("t"), title: o.title, rev: 1, blocks: [{ id: id("b"), md: o.md || "" }] }; tabs.push(newTab); }
      if (o.op === "rename_tab") t.title = o.title;
      if (o.op === "delete_tab") tabs.splice(tabs.indexOf(t), 1);
    });
    t.rev++; log.push({ tab: t.id, rev: t.rev, by: by, blocks: changed });
    return { ok: true, tab: t.id, rev: t.rev, changed: changed, new_tab: newTab && newTab.id };
  }
  function read(t, since) {
    t = tabOf(t);
    var out = { tab: t.id, title: t.title, rev: t.rev, tabs: tabs.map(function (x) { return { id: x.id, title: x.title, rev: x.rev, blocks: x.blocks.length }; }) };
    if (since != null) { var ch = {}; log.forEach(function (e) { if (e.tab === t.id && e.rev > since) e.blocks.forEach(function (b) { ch[b] = e.by; }); });
      out.changed = t.blocks.filter(function (b) { return ch[b.id]; }).map(function (b) { return { id: b.id, md: b.md, by: ch[b.id] }; }); out.removed = []; return out; }
    out.blocks = t.blocks.map(function (b) { return { id: b.id, md: b.md }; }); return out;
  }
  var calls = [];
  window.__mock = { calls: calls, tabs: tabs, hermesEdit: function (ops, t) { var r = apply(t, ops, "hermes"); (listeners.doc || []).forEach(function (f) { f({}); }); return r; } };
  function later(v) { return new Promise(function (r) { setTimeout(function () { r(JSON.parse(JSON.stringify(v))); }, 20); }); }
  window.hermes = {
    doc: { read: function (t, s) { return later(read(t, s)); }, edit: function (t, ops, base) { calls.push({ op: "edit", ops: ops }); return later(apply(t, ops, "user")); },
      ask: function (a) { calls.push({ op: "ask", a: a }); return later({ ok: true, id: "req1", mode: "submitted" }); } },
    comment: function (a) { calls.push({ op: "comment", a: a }); },
    on: function (n, f) { (listeners[n] = listeners[n] || []).push(f); },
    view: function (c) { window.__mock.view = c; return Promise.resolve(); },
    chrome: function () { return Promise.reject(new Error("no host")); },
    vendor: function () { return Promise.reject(new Error("no host")); },
    report: function () { return Promise.resolve(); }
  };
})();
