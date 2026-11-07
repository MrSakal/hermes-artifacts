/* hermes-artifacts Doc runtime: a live doc the user and Hermes edit together.
 *
 * The doc is tabs of blocks (each a piece of Markdown with a stable id) kept on the Hermes server.
 * Click a block to edit it; changes save as you type. Hermes edits blocks too (artifact_doc_edit) and
 * its changes appear here at once. "@Hermes …" typed into an empty block asks Hermes, who answers in
 * that block; a selection offers "Edit with Hermes" and "Comment". Exports: Word, PDF, Markdown, HTML.
 */
(function () {
  "use strict";
  // The UI's words in the app's language (hu over en, key by key); messages to Hermes are always English.
  function pickLang(t, l) { var o = {}, k; for (k in t.en) o[k] = t.en[k]; for (k in t[l] || {}) o[k] = t[l][k]; return o; }
  var kit = window.kit, h = kit.h, C = kit.content, md = window.md, hm = window.hermes;
  var L = /^hu\b/i.test(kit.content.lang || navigator.language || "") ? "hu" : "en";
  var T = pickLang({
    en: { exp: "Export", docx: "Word (.docx)", pdf: "PDF", mdf: "Markdown (.md)", html: "Web page (HTML)",
      building: "Building…", noLib: "The export library didn't load (open the doc in Hermes Desktop)", empty: "Click to start writing, or type @Hermes and a request.",
      saving: "Saving…", saved: "Saved", offline: "Not saved: open the doc in Hermes Desktop", conflict: "Hermes changed this block meanwhile: it now shows Hermes' text",
      asking: "Hermes is writing…", askHint: "@Hermes + Enter asks Hermes here", editWith: "Edit with Hermes", comment: "Comment",
      editAsk: "What should Hermes change?", send: "Send", newTab: "New tab", tabName: "Tab name", delTab: "Delete tab", rename: "Rename",
      byHermes: "Hermes edited this", sent: "Sent to Hermes", drafted: "Put in the chat box: press Enter there", untitled: "Untitled" },
    hu: { exp: "Exportálás", docx: "Word (.docx)", pdf: "PDF", mdf: "Markdown (.md)", html: "Weboldal (HTML)",
      building: "Készül…", noLib: "Az export könyvtár nem töltődött be (nyisd meg a Hermes Desktopban)", empty: "Kattints ide és írj, vagy írd be: @Hermes és a kérésed.",
      saving: "Mentés…", saved: "Elmentve", offline: "Nincs mentve: nyisd meg a Hermes Desktopban", conflict: "Ezt a blokkot közben a Hermes módosította: most az ő szövege látszik",
      asking: "A Hermes ír…", askHint: "@Hermes + Enter: kérés a Hermestől ide", editWith: "Szerkesztés a Hermesszel", comment: "Komment",
      editAsk: "Mit változtasson a Hermes?", send: "Küldés", newTab: "Új fül", tabName: "Fül neve", delTab: "Fül törlése", rename: "Átnevezés",
      byHermes: "A Hermes módosította", sent: "Elküldve a Hermesnek", drafted: "Beírva a chat mezőbe: nyomj ott Entert", untitled: "Névtelen" }
  }, L);

  var bar = document.getElementById("doc-bar"), page = document.getElementById("doc-page"), toc = document.getElementById("doc-toc");
  var tabsEl = document.getElementById("doc-tabs");
  bar.className = "kit-bar";
  var live = !!(hm && hm.doc) && !C.thumb;

  // ------------------------------------------------------------------ the doc
  var tabs, cur = 0, ast = [];
  if (C.doc && C.doc.tabs && C.doc.tabs.length) tabs = C.doc.tabs;
  else tabs = [{ id: "local", title: C.title || "Doc", rev: 0, blocks: [{ id: "local-0", md: kit.fileText("doc.md") || "" }] }];
  function tab() { return tabs[cur]; }
  function tabMd(t) { return t.blocks.map(function (b) { return b.md; }).join("\n\n") + "\n"; }
  function fullText() {
    return tabs.length === 1 ? tabMd(tabs[0]) : tabs.map(function (t) { return "# " + t.title + "\n\n" + tabMd(t); }).join("\n\n");
  }
  var text = fullText(); // what the Markdown export writes

  function imgSrc(p) { return /^data:image\//.test(p) ? p : kit.fileUrl(p) || ""; }
  function title() {
    var h1 = ast.find(function (b) { return b.t === "h" && b.level === 1; });
    return (h1 && md.plain(h1.c)) || C.title || "Doc";
  }
  function cleanHtml() { return md.html(md.parse(fullText()), imgSrc); }
  function blockEl(id) { return page.querySelector('[data-block="' + id + '"]'); }
  function indexOf(id) { for (var i = 0; i < tab().blocks.length; i++) if (tab().blocks[i].id === id) return i; return -1; }

  // ------------------------------------------------------------------ drawing
  var editing = null; // {id, ta}
  var pendingAsks = {}; // block id -> true while Hermes answers there

  function blockHtml(b) {
    var s = (b.md || "").trim();
    if (!s) return '<p class="doc-ph">' + kit.esc(tab().blocks.length === 1 ? T.empty : "") + "</p>";
    if (pendingAsks[b.id] || /^@hermes\b/i.test(s)) {
      return '<p class="doc-ask' + (pendingAsks[b.id] ? " is-pending" : "") + '"><span class="doc-ask-at">@Hermes</span> ' +
        kit.esc(s.replace(/^@hermes\b\s*/i, "")) + (pendingAsks[b.id] ? ' <span class="doc-ask-st">' + kit.esc(T.asking) + "</span>" : "") + "</p>";
    }
    return md.html(md.parse(s), imgSrc);
  }
  function drawBlock(b, el) {
    el = el || h("div", { "class": "doc-blk" });
    el.setAttribute("data-block", b.id);
    el.id = "blk-" + b.id;
    el.innerHTML = blockHtml(b);
    return el;
  }
  function render() {
    var keep = editing && blockEl(editing.id);
    var caret = keep && document.activeElement === editing.ta ? [editing.ta.selectionStart, editing.ta.selectionEnd] : null;
    var nodes = tab().blocks.map(function (b) {
      if (keep && b.id === editing.id) return keep;
      return drawBlock(b);
    });
    page.replaceChildren.apply(page, nodes);
    if (editing && !keep) editing = null;
    if (caret) { editing.ta.focus({ preventScroll: true }); editing.ta.setSelectionRange(caret[0], caret[1]); } // moving it blurred it
    ast = md.parse(fullText());
    text = fullText();
    drawToc(); drawTabs();
  }
  function drawToc() {
    toc.replaceChildren.apply(toc, Array.prototype.map.call(page.querySelectorAll(".doc-blk > h1, .doc-blk > h2, .doc-blk > h3"), function (el) {
      return h("a", { href: "#", "class": "l" + el.tagName[1], text: el.textContent,
        onclick: function (e) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "start" }); } });
    }));
  }
  function drawTabs() {
    if (!tabsEl) return;
    tabsEl.hidden = !live && tabs.length < 2;
    tabsEl.replaceChildren.apply(tabsEl, tabs.map(function (t, i) {
      return h("button", { type: "button", "class": "doc-tab" + (i === cur ? " is-on" : ""), text: t.title || T.untitled,
        onclick: function () { if (i !== cur) { commit(); cur = i; editing = null; render(); pull(true); sendView(); } },
        ondblclick: function () { if (live) renameTab(i); },
        oncontextmenu: function (e) {
          if (!live) return;
          e.preventDefault();
          kit.menu(e.currentTarget, [{ label: T.rename, onClick: function () { renameTab(i); } }]
            .concat(tabs.length > 1 ? [{ label: T.delTab, onClick: function () { cur = i; edit([{ op: "delete_tab" }]).then(function () { cur = 0; pull(true); }); } }] : []));
        } });
    }).concat(live ? [h("button", { type: "button", "class": "doc-tab doc-tab-add", title: T.newTab, "aria-label": T.newTab, text: "+",
      onclick: function () {
        var name = prompt(T.tabName, T.newTab);
        if (!name) return;
        edit([{ op: "add_tab", title: name, md: "" }]).then(function (r) { pull(true).then(function () {
          var i = tabs.findIndex(function (t) { return t.id === r.new_tab; });
          if (i >= 0) { cur = i; render(); }
        }); });
      } })] : []));
  }
  function renameTab(i) {
    var name = prompt(T.tabName, tabs[i].title);
    if (!name || name === tabs[i].title) return;
    var was = cur; cur = i;
    edit([{ op: "rename_tab", title: name }]).then(function () { tabs[i].title = name; cur = was; drawTabs(); });
  }

  // ------------------------------------------------------------------ saving (each change goes to the server)
  var status = h("span", { "class": "doc-status", "aria-live": "polite" }), statusTimer = null;
  function setStatus(s) {
    status.textContent = s;
    clearTimeout(statusTimer);
    if (s === T.saved) statusTimer = setTimeout(function () { status.textContent = ""; }, 1500);
  }
  var chain = Promise.resolve();
  function edit(ops) {
    if (!live) { setStatus(T.offline); return Promise.reject(new Error(T.offline)); }
    var t = tab();
    setStatus(T.saving);
    chain = chain.then(function () {
      return hm.doc.edit(t.id, ops, t.rev).then(function (r) {
        if (r && r.conflict) { kit.toast(T.conflict); return pull(true).then(function () { return r; }); }
        if (r && r.rev) { if (r.rev === t.rev + 1) t.rev = r.rev; else pull(true); } // someone else edited in between
        setStatus(T.saved);
        return r;
      });
    }).catch(function (e) { setStatus(""); kit.toast(String(e && e.message || e)); });
    return chain;
  }

  // ------------------------------------------------------------------ editing a block in place
  function autosize(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
  function startEdit(id, at) {
    if (!live) return;
    if (editing && editing.id === id) return;
    commit();
    var b = tab().blocks[indexOf(id)], el = blockEl(id);
    if (!b || !el) return;
    var ta = h("textarea", { "class": "doc-src", spellcheck: "true", rows: 1, "aria-label": "Markdown" });
    ta.value = b.md;
    el.replaceChildren(ta);
    el.classList.add("is-editing");
    editing = { id: id, ta: ta, saved: b.md, timer: null };
    autosize(ta);
    ta.focus();
    var pos = at === "start" ? 0 : ta.value.length;
    ta.setSelectionRange(pos, pos);
    ta.addEventListener("input", function () {
      autosize(ta);
      b.md = ta.value;
      clearTimeout(editing.timer);
      editing.timer = setTimeout(function () { save(false); }, 700);
    });
    ta.addEventListener("keydown", onKey);
    ta.addEventListener("blur", function () { setTimeout(function () { if (editing && editing.ta === ta && document.activeElement !== ta) commit(); }, 0); });
    ta.addEventListener("select", sendView);
    sendView();
  }
  function save(final) {
    if (!editing) return Promise.resolve();
    var e = editing, b = tab().blocks[indexOf(e.id)];
    clearTimeout(e.timer);
    if (!b || b.md === e.saved) return Promise.resolve();
    e.saved = b.md;
    var p = edit([{ op: "replace", block: e.id, md: b.md }]);
    if (final && /\n\s*\n/.test(b.md.trim())) p = p.then(function () { return pull(true); }); // it split into blocks
    return p;
  }
  function commit() {
    if (!editing) return;
    var e = editing;
    save(true);
    editing = null;
    var b = tab().blocks[indexOf(e.id)], el = blockEl(e.id);
    if (b && el) { el.classList.remove("is-editing"); drawBlock(b, el); }
    ast = md.parse(fullText()); text = fullText();
    drawToc();
    sendView();
  }
  function kindOf(s) { return /^#{1,6}\s/.test(s) ? "h" : /^(```|~~~|\||[-+*]\s|\d+[.)]\s|>)/.test(s.trim()) ? "multi" : "p"; }
  function onKey(e) {
    var ta = e.target, id = editing && editing.id, i = indexOf(id), atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
    var atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
    if (e.key === "Escape") { e.preventDefault(); ta.blur(); commit(); return; }
    if (e.key === "Enter" && !e.shiftKey) {
      var ask = /^@hermes\b\s*([\s\S]+)$/i.exec(ta.value.trim());
      if (ask) { e.preventDefault(); askHere(id, ask[1].trim()); return; }
      if (atEnd && (kindOf(ta.value) !== "multi" || /\n\s*$/.test(ta.value) || ta.value.trim() === "")) {
        e.preventDefault();
        if (kindOf(ta.value) === "multi") ta.value = ta.value.replace(/\n\s*$/, "");
        tab().blocks[i].md = ta.value;
        var nb = { id: null, md: "" };
        save(false).then(function () { return edit([{ op: "insert", after: id, md: "" }]); }).then(function (r) {
          if (!r || !r.changed) return;
          nb.id = r.changed[r.changed.length - 1];
          tab().blocks.splice(indexOf(id) + 1, 0, nb);
          commit();
          var el = drawBlock(nb), prev = blockEl(id);
          prev ? prev.after(el) : page.appendChild(el);
          startEdit(nb.id, "start");
        });
        return;
      }
    }
    if (e.key === "Backspace" && atStart && ta.value === "" && tab().blocks.length > 1) {
      e.preventDefault();
      var prevId = i > 0 ? tab().blocks[i - 1].id : null;
      tab().blocks.splice(i, 1);
      editing = null;
      var el = blockEl(id); if (el) el.remove();
      edit([{ op: "delete", block: id }]);
      if (prevId) startEdit(prevId, "end");
      return;
    }
    if (e.key === "ArrowUp" && atStart && i > 0) { e.preventDefault(); startEdit(tab().blocks[i - 1].id, "end"); }
    if (e.key === "ArrowDown" && atEnd && i < tab().blocks.length - 1) { e.preventDefault(); startEdit(tab().blocks[i + 1].id, "start"); }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(false); }
  }
  page.addEventListener("click", function (e) {
    if (e.target.closest("a[href], input, textarea")) return;
    var sel = window.getSelection && String(window.getSelection());
    if (sel) return; // selecting text, not editing
    var el = e.target.closest(".doc-blk");
    if (el) startEdit(el.getAttribute("data-block"), "end");
    else if (live && e.target === page && tab().blocks.length) startEdit(tab().blocks[tab().blocks.length - 1].id, "end");
  });

  // ------------------------------------------------------------------ asking Hermes in the doc
  function toChat(kind, text, blocks, selection) {
    return hm.doc.ask({ kind: kind, tab: tab().id, tabTitle: tab().title, blocks: blocks, selection: selection || "", text: text })
      .then(function (r) { kit.toast(r && r.mode === "draft" ? T.drafted : T.sent); return r; })
      .catch(function (e) { kit.toast(String(e && e.message || e)); });
  }
  function askHere(id, request) {
    var b = tab().blocks[indexOf(id)];
    b.md = "@Hermes " + request;
    pendingAsks[id] = true;
    save(false);
    commit();
    toChat("ask", request, [id]);
  }

  // Selection: "Edit with Hermes" and "Comment" (on text the user selected, not while typing).
  var selBar = h("div", { "class": "doc-selbar", hidden: true });
  document.body.appendChild(selBar);
  function selectedBlocks() {
    var s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return null;
    var r = s.getRangeAt(0), ids = [];
    tab().blocks.forEach(function (b) { var el = blockEl(b.id); if (el && r.intersectsNode(el)) ids.push(b.id); });
    return ids.length ? { ids: ids, text: String(s).trim(), rect: r.getBoundingClientRect() } : null;
  }
  function showSelBar() {
    var sel = live && !editing ? selectedBlocks() : null;
    if (!sel || !sel.text) { selBar.hidden = true; return; }
    selBar.replaceChildren(
      kit.labelled(kit.button(T.editWith, "sparkle", function () { askEdit(sel); }), T.editWith),
      kit.labelled(kit.button(T.comment, "comment", function () {
        selBar.hidden = true;
        hm.comment && hm.comment({ selector: "#blk-" + sel.ids[0], text: sel.text.slice(0, 200), label: "text", tab: tabs[cur] && tabs[cur].id });
      }), T.comment));
    selBar.hidden = false;
    var top = sel.rect.top - selBar.offsetHeight - 8;
    selBar.style.top = Math.max(52, top) + "px";
    selBar.style.left = Math.max(8, Math.min(innerWidth - selBar.offsetWidth - 8, sel.rect.left + sel.rect.width / 2 - selBar.offsetWidth / 2)) + "px";
  }
  function askEdit(sel) {
    var input = h("input", { type: "text", "class": "doc-askin", placeholder: T.editAsk, "aria-label": T.editAsk });
    var go = function () {
      var v = input.value.trim();
      if (!v) return;
      selBar.hidden = true;
      sel.ids.forEach(function (id) { var el = blockEl(id); if (el) el.classList.add("is-pending"); });
      toChat("edit", v, sel.ids, sel.text);
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } if (e.key === "Escape") selBar.hidden = true; });
    selBar.replaceChildren(input, kit.labelled(kit.button(T.send, "", go), T.send));
    input.focus();
  }
  var selTimer = null;
  document.addEventListener("selectionchange", function () {
    clearTimeout(selTimer);
    if (selBar.contains(document.activeElement)) return;
    selTimer = setTimeout(showSelBar, 250);
  });
  document.addEventListener("mousedown", function (e) {
    if (!selBar.contains(e.target)) selBar.hidden = true;
    if (editing && !e.target.closest('[data-block="' + editing.id + '"]') && !e.target.closest(".doc-blk")) commit(); // clicked outside the doc's blocks
  });

  // ------------------------------------------------------------------ live: Hermes' changes appear here
  var pulling = null;
  function pull(force) {
    if (!live) return Promise.resolve();
    if (pulling) return pulling;
    var t = tab();
    pulling = hm.doc.read(t.id, force ? null : t.rev).then(function (r) {
      if (!force && !(r.changed && r.changed.length) && !(r.removed && r.removed.length) && r.rev === t.rev && r.tabs.length === tabs.length) return;
      var byHermes = (r.changed || []).filter(function (c) { return c.by === "hermes"; }).map(function (c) { return c.id; });
      return hm.doc.read(t.id, null).then(function (full) { merge(full, byHermes); });
    }).catch(function () {}).then(function () { pulling = null; });
    return pulling;
  }
  function merge(full, flash) {
    // Other tabs: titles and order; this tab: its blocks, keeping the block being typed in.
    var byId = {};
    tabs.forEach(function (t) { byId[t.id] = t; });
    var curId = tab().id;
    tabs = full.tabs.map(function (o) { var t = byId[o.id] || { id: o.id, blocks: [], rev: 0 }; t.title = o.title; return t; });
    cur = Math.max(0, tabs.findIndex(function (t) { return t.id === curId; }));
    var t = tabs[cur];
    if (t.id !== full.tab) return;
    var mine = editing && t.blocks[indexOf(editing.id)];
    t.blocks = full.blocks.map(function (b) {
      if (mine && b.id === mine.id && mine.md !== editing.saved) return mine; // typing: theirs waits
      return { id: b.id, md: b.md };
    });
    t.rev = full.rev;
    flash.forEach(function (id) { delete pendingAsks[id]; });
    render();
    flash.forEach(function (id) {
      var el = blockEl(id);
      if (!el) return;
      el.classList.add("by-hermes"); el.title = T.byHermes;
      setTimeout(function () { el.classList.remove("by-hermes"); el.removeAttribute("title"); }, 2400);
    });
    page.querySelectorAll(".doc-blk.is-pending").forEach(function (el) { if (flash.indexOf(el.getAttribute("data-block")) >= 0) el.classList.remove("is-pending"); });
  }
  if (live) {
    hm.on("doc", function () { pull(false); });
    setInterval(function () { if (!document.hidden) pull(false); }, 2500);
  }

  // ------------------------------------------------------------------ view context (with the next chat message)
  function sendView() {
    kit.view(function () {
      var head = kit.inView("#doc-page h1, #doc-page h2, #doc-page h3");
      var sel = "", blocks = [];
      if (editing) { var ta = editing.ta; sel = ta.value.slice(ta.selectionStart, ta.selectionEnd); blocks = [editing.id]; }
      else { var s = selectedBlocks(); if (s) { sel = s.text; blocks = s.ids; } }
      return { mode: editing ? "edit" : "read", tab: { id: tab().id, title: tab().title, rev: tab().rev }, section: head ? head.textContent.trim().slice(0, 80) : null,
        selected: sel ? [sel.trim().slice(0, 300)] : [], blocks: blocks.slice(0, 20),
        asking: Object.keys(pendingAsks), version: C.version };
    });
  }
  window.addEventListener("scroll", sendView, { passive: true });
  document.addEventListener("selectionchange", sendView);

  // ------------------------------------------------------------------ export helpers
  var libs = {};
  function lib(name, global) {
    if (window[global]) return Promise.resolve(window[global]);
    if (!window.hermes || !window.hermes.vendor) return Promise.reject(new Error(T.noLib));
    return (libs[name] = libs[name] || window.hermes.vendor(name).then(function (s) {
      (0, eval)(s + "\n//# sourceURL=vendor/" + name);
      if (!window[global]) throw new Error(T.noLib);
      return window[global];
    }));
  }
  function busy(on) {
    var b = document.querySelector(".sl-busy, .doc-busy");
    if (on && !b) document.body.appendChild(h("div", { "class": "kit-empty doc-busy", style: "position:fixed;inset:0;z-index:200;min-height:0;background:color-mix(in srgb,var(--color-bg) 70%,transparent)", text: T.building }));
    if (!on && b) b.remove();
  }
  function css() {
    return Array.prototype.map.call(document.styleSheets, function (ss) {
      try { return Array.prototype.map.call(ss.cssRules, function (r) { return r.cssText; }).join("\n"); } catch (e) { return ""; }
    }).join("\n");
  }

  function exportHtml() {
    var doc = '<!doctype html><html lang="' + L + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: https:; style-src 'unsafe-inline'\">" +
      "<title>" + kit.esc(title()) + "</title><style>" + css() + "body{padding:40px 24px}</style></head><body><article class=\"doc-prose\">" +
      cleanHtml() + "</article></body></html>";
    kit.download(kit.slug(title()) + ".html", doc, "text/html");
  }

  // --- Word: a minimal WordprocessingML package, zipped with fflate ---------------------------
  function xesc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ""); }

  function docxParts() {
    var rels = [], media = {}, imgN = 0;
    function rel(type, target, ext) {
      var id = "rId" + (rels.length + 10);
      rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '" Target="' + xesc(target) + '"' + (ext ? ' TargetMode="External"' : "") + "/>");
      return id;
    }
    function runs(nodes, fmt) {
      fmt = fmt || {};
      return nodes.map(function (n) {
        var f = Object.assign({}, fmt);
        if (n.t === "strong") { f.b = true; return runs(n.c, f); }
        if (n.t === "em") { f.i = true; return runs(n.c, f); }
        if (n.t === "del") { f.s = true; return runs(n.c, f); }
        if (n.t === "br") return "<w:r><w:br/></w:r>";
        if (n.t === "link") {
          if (!/^(https?:|mailto:)/i.test(n.href)) return runs(n.c, f);
          return '<w:hyperlink r:id="' + rel("hyperlink", n.href, true) + '">' + runs(n.c, Object.assign(f, { link: true })) + "</w:hyperlink>";
        }
        if (n.t === "img") return image(n) || run("[" + (n.alt || "image") + "]", f);
        if (n.t === "code") { f.code = true; return run(n.v, f); }
        return run(n.v, f);
      }).join("");
    }
    function run(t, f) {
      // CT_RPr element order: rStyle, rFonts, b, i, strike, shd.
      var p = (f.link ? '<w:rStyle w:val="Hyperlink"/>' : "") +
        (f.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : "") +
        (f.b ? "<w:b/>" : "") + (f.i ? "<w:i/>" : "") + (f.s ? "<w:strike/>" : "") +
        (f.code ? '<w:shd w:val="clear" w:color="auto" w:fill="F1EFE8"/>' : "");
      return "<w:r>" + (p ? "<w:rPr>" + p + "</w:rPr>" : "") + '<w:t xml:space="preserve">' + xesc(t) + "</w:t></w:r>";
    }
    function image(n) {
      var data = imgSrc(n.src), m = /^data:image\/(png|jpe?g|gif);base64,(.*)$/i.exec(data || "");
      if (!m) return null;
      var el = Array.prototype.find.call(page.querySelectorAll("img"), function (i) { return i.getAttribute("alt") === n.alt; });
      var w = el && el.naturalWidth || 600, hh = el && el.naturalHeight || 400, max = 600;
      if (w > max) { hh = hh * max / w; w = max; }
      var name = "image" + (++imgN) + "." + (m[1].toLowerCase() === "jpg" ? "jpeg" : m[1].toLowerCase());
      media["word/media/" + name] = Uint8Array.from(atob(m[2]), function (c) { return c.charCodeAt(0); });
      var id = rel("image", "media/" + name), cx = Math.round(w * 9525), cy = Math.round(hh * 9525);
      return '<w:r><w:drawing><wp:inline><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + imgN + '" name="' + name + '" descr="' + xesc(n.alt || "") + '"/>' +
        '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + imgN + '" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
        "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
    }
    function para(inner, pPr) { return "<w:p>" + (pPr ? "<w:pPr>" + pPr + "</w:pPr>" : "") + inner + "</w:p>"; }
    function blocks(list, depth, quote) {
      return list.map(function (b) {
        // CT_PPr order: pStyle, keepNext, numPr, pBdr, shd, spacing, ind, jc.
        var qb = quote ? '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BBBBBB"/></w:pBdr>' : "";
        var qi = quote ? '<w:ind w:left="567"/>' : "";
        var q = qb + qi;
        switch (b.t) {
          case "h": return para(runs(b.c), '<w:pStyle w:val="Heading' + Math.min(b.level, 4) + '"/>');
          case "p": return para(runs(b.c), q);
          case "hr": return para("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CCCCCC"/></w:pBdr>');
          case "code": return b.v.split("\n").map(function (l) { return para(run(l || " ", { code: true }), '<w:shd w:val="clear" w:color="auto" w:fill="F1EFE8"/><w:spacing w:after="0"/>'); }).join("");
          case "quote": return blocks(b.c, depth, true);
          case "list":
            return b.items.map(function (it) {
              var head = it.c[0] && it.c[0].t === "p" ? it.c[0] : null;
              var mark = it.task ? (it.checked ? "☑ " : "☐ ") : "";
              var p0 = para((mark ? run(mark, {}) : "") + (head ? runs(head.c) : ""),
                '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="' + Math.min(depth, 8) + '"/><w:numId w:val="' + (b.ordered ? 2 : 1) + '"/></w:numPr>' + qb);
              return p0 + blocks(head ? it.c.slice(1) : it.c, depth + 1, quote);
            }).join("");
          case "table":
            var cell = function (c, k, hd) {
              var a = b.align[k] ? '<w:jc w:val="' + (b.align[k] === "right" ? "right" : b.align[k] === "center" ? "center" : "left") + '"/>' : "";
              return "<w:tc><w:tcPr>" + (hd ? '<w:shd w:val="clear" w:color="auto" w:fill="F1EFE8"/>' : "") + "</w:tcPr>" + para(runs(c, hd ? { b: true } : {}), a) + "</w:tc>";
            };
            return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/>' +
              '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/><w:insideH w:val="single" w:sz="4" w:color="CCCCCC"/></w:tblBorders></w:tblPr>' +
              "<w:tblGrid>" + b.head.map(function () { return '<w:gridCol w:w="' + Math.round(9298 / b.head.length) + '"/>'; }).join("") + "</w:tblGrid>" +
              "<w:tr>" + b.head.map(function (c, k) { return cell(c, k, true); }).join("") + "</w:tr>" +
              b.rows.map(function (r) { return "<w:tr>" + r.map(function (c, k) { return cell(c, k, false); }).join("") + "</w:tr>"; }).join("") +
              "</w:tbl>" + para("");
        }
        return "";
      }).join("");
    }
    var body = blocks(ast, 0, false);
    var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
    var lvls = function (ordered) {
      var out = "";
      for (var k = 0; k < 9; k++) out += '<w:lvl w:ilvl="' + k + '"><w:start w:val="1"/><w:numFmt w:val="' + (ordered ? (k % 3 === 0 ? "decimal" : k % 3 === 1 ? "lowerLetter" : "lowerRoman") : "bullet") +
        '"/><w:lvlText w:val="' + (ordered ? "%" + (k + 1) + "." : ["•", "◦", "▪"][k % 3]) + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + (720 + 360 * k) + '" w:hanging="360"/></w:pPr></w:lvl>';
      return out;
    };
    var hstyle = function (n, size) {
      return '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
        '<w:pPr><w:keepNext/><w:spacing w:before="' + (n === 1 ? 0 : 320) + '" w:after="120"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr>' +
        '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>' + (n > 2 ? "<w:b/>" : "") + '<w:sz w:val="' + size + '"/></w:rPr></w:style>';
    };
    return {
      "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      "docProps/core.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        "<dc:title>" + xesc(title()) + '</dc:title><dc:creator>Hermes</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + "Z</dcterms:created></cp:coreProperties>",
      "word/_rels/document.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' + rels.join("") + "</Relationships>",
      "word/styles.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + NS + '>' +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
        '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
        hstyle(1, 44) + hstyle(2, 32) + hstyle(3, 26) + hstyle(4, 23) +
        '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>' +
        '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="C96442"/><w:u w:val="single"/></w:rPr></w:style>' +
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>',
      "word/numbering.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ' + NS + '>' +
        '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + lvls(false) + "</w:abstractNum>" +
        '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + lvls(true) + "</w:abstractNum>" +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>',
      "word/document.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + "><w:body>" + body +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>',
      _media: media
    };
  }

  async function exportDocx() {
    busy(true);
    try {
      var fflate = await lib("fflate.umd.js", "fflate");
      var parts = docxParts(), files = {}, enc = new TextEncoder();
      Object.keys(parts).forEach(function (k) { if (k !== "_media") files[k] = enc.encode(parts[k]); });
      Object.keys(parts._media).forEach(function (k) { files[k] = [parts._media[k], { level: 0 }]; });
      var zip = fflate.zipSync(files, { level: 6 });
      kit.download(kit.slug(title()) + ".docx", new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  // --- PDF: A4 pages laid out from whole blocks, each page pictured (SVG foreignObject) ----------
  function pages() {
    var PH = 1123 - 152, holder = h("div", { style: "position:fixed;left:-30000px;top:0" });
    var probe = h("article", { "class": "doc-prose doc-pdfpage", style: "height:auto" });
    probe.innerHTML = cleanHtml();
    holder.appendChild(probe); document.body.appendChild(holder);
    var out = [], curr = [], used = 0;
    Array.prototype.slice.call(probe.children).forEach(function (el) {
      var cs = getComputedStyle(el);
      var hgt = el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      var keepNext = /^H[1-6]$/.test(el.tagName);
      if (used + hgt > PH && curr.length) { out.push(curr); curr = []; used = 0; }
      curr.push(el.outerHTML); used += hgt;
      if (keepNext && used > PH * 0.85) { curr.pop(); out.push(curr); curr = [el.outerHTML]; used = hgt; }
    });
    if (curr.length) out.push(curr);
    holder.remove();
    return out;
  }
  function picture(htmlStr, sheet) {
    return new Promise(function (resolve, reject) {
      var wrap = h("article", { "class": "doc-prose doc-pdfpage" });
      wrap.innerHTML = htmlStr;
      wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      var xhtml = new XMLSerializer().serializeToString(wrap);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123"><foreignObject width="100%" height="100%">' +
        '<style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[' + sheet + ']]></style>' + xhtml + "</foreignObject></svg>";
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas"); c.width = 794 * 2; c.height = 1123 * 2;
        var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = function () { reject(new Error("page picture failed")); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }
  async function exportPdf() {
    busy(true);
    try {
      var PDFLib = await lib("pdf-lib.min.js", "PDFLib");
      var pdf = await PDFLib.PDFDocument.create();
      pdf.setTitle(title()); pdf.setCreator("Hermes Artifacts");
      // Light colors on paper whatever the viewer's theme.
      var sheet = css().replace(/]]>/g, "") + ".doc-pdfpage{--color-fg:#1f1e1d;--color-fg-secondary:#3d3c39;--color-fg-muted:#6f6d66;--color-border-line:#e7e5dd;--color-border-strong:#cfccc0;--color-hover:rgba(0,0,0,.05);--color-accent:#c96442}";
      var list = pages();
      for (var i = 0; i < list.length; i++) {
        var c = await picture(list[i].join(""), sheet);
        var jpg = await pdf.embedJpg(c.toDataURL("image/jpeg", 0.9));
        var p = pdf.addPage([595.28, 841.89]);
        p.drawImage(jpg, { x: 0, y: 0, width: 595.28, height: 841.89 });
      }
      var bytes = await pdf.save();
      kit.download(kit.slug(title()) + ".pdf", new Blob([bytes], { type: "application/pdf" }), "application/pdf");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  // ------------------------------------------------------------------ chrome
  var titleEl = h("span", { "class": "kit-title", style: "visibility:hidden" }); // the host toolbar shows the title
  var exportList = [{ id: "docx", label: T.docx, run: exportDocx }, { id: "pdf", label: T.pdf, run: exportPdf },
    { id: "md", label: T.mdf, run: function () { kit.download(kit.slug(title()) + ".md", fullText(), "text/markdown"); } },
    { id: "html", label: T.html, run: exportHtml }];
  var expBtn = kit.labelled(kit.button(T.exp, "download", function () {
    kit.menu(expBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; }));
  }), T.exp);
  expBtn.hidden = true;
  kit.exports(exportList).then(function (hosted) { expBtn.hidden = hosted; });
  var hint = h("span", { "class": "doc-hint", text: live ? T.askHint : "" });
  bar.append(titleEl, hint, status, expBtn);

  render();
  titleEl.textContent = title();
  if (live) pull(true);
  kit.ready();
})();
