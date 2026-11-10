/* hermes-artifacts Dashboard: Edit the page (Claude's editor mode).
 *
 * The page's own words are edited in place and saved into its file; cards move earlier or later or go.
 * What a script or the data writes (a data-draw, a data-source mark, anything inside a drawing) isn't
 * the page's text and can't be edited by hand: it says so, and Hermes changes it. Every change saves
 * automatically as a new version; Undo and Redo step through this session's changes.
 */
(function () {
  "use strict";
  var kit = window.kit;
  var CARD = ".card, .c-card, .kpi, .tile, section, article, [data-card]";
  var SKIP = "script, style, template, svg, select, option, textarea, input, button, canvas, iframe, noscript";
  var INLINE = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, SMALL: 1, SUB: 1, SUP: 1, MARK: 1, CODE: 1, A: 1, SPAN: 1, ABBR: 1, TIME: 1 };

  function written(el) { return !!(el.closest("[data-draw]") || el.hasAttribute("data-source") || el.closest("[data-source] svg")); }
  function textual(el) {
    if (el.matches(SKIP) || el.closest(SKIP)) return false;
    var has = false;
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3 && n.nodeValue.trim()) has = true;
      else if (n.nodeType === 1 && (!INLINE[n.tagName] || n.hasAttribute("data-source") || n.hasAttribute("data-draw"))) return false;
    }
    return has;
  }
  /** Number what can be edited in the source: words the page writes itself, and cards. */
  function annotate(tpl) {
    var n = 0;
    tpl.content.querySelectorAll("*").forEach(function (el) {
      if (el.closest(SKIP) && !el.matches("svg")) return;
      if (textual(el) && !written(el)) el.setAttribute("data-e", "t" + (n++));
      else if (el.matches(CARD) && !el.closest("[data-draw]")) el.setAttribute("data-e", "c" + (n++));
    });
  }
  function clean(html) { return html.replace(/\sdata-e="[tc]\d+"/g, ""); }
  function sanitizeInline(el) {
    // What a person types stays words: inline marks only, no attributes but href on a link.
    var out = document.createElement("div");
    (function copy(from, to) {
      from.childNodes.forEach(function (n) {
        if (n.nodeType === 3) to.appendChild(document.createTextNode(n.nodeValue));
        else if (n.nodeType === 1 && INLINE[n.tagName] && n.tagName !== "A") { var e = document.createElement(n.tagName); copy(n, e); to.appendChild(e); }
        else if (n.nodeType === 1) copy(n, to);
      });
    })(el, out);
    return out.innerHTML;
  }

  function init(api) {
    var T = api.T, h = kit.h, C = kit.content, on = false, tpl = null, path = null, stack = [], at = -1, timer = null, saving = false, pendingSave = false;
    var barEl = null, tools = null, status = "";
    function source() { return tpl.innerHTML; }
    function push() { stack = stack.slice(0, at + 1); stack.push(source()); at = stack.length - 1; if (stack.length > 100) { stack.shift(); at--; } }
    function load(html) { tpl.innerHTML = html; api.remount(html); decorate(); }
    function scheduleSave() { clearTimeout(timer); status = T.editSaving; showBar(); timer = setTimeout(save, 700); }
    function save() {
      if (saving) { pendingSave = true; return; }
      saving = true;
      var files = {}; files[path] = clean(source());
      window.hermes.save(files, C.version).then(function (r) {
        saving = false;
        if (r && r.conflict) { status = T.editConflict; showBar(); return; }
        if (r && r.version) C.version = r.version;
        status = T.editSaved; showBar();
        if (pendingSave) { pendingSave = false; save(); }
      }, function (e) {
        saving = false; status = T.editFailed; showBar();
        setTimeout(save, 3000);
      });
    }
    function node(id) { return tpl.content.querySelector('[data-e="' + id + '"]'); }
    function decorate() {
      var root = api.root;
      root.querySelectorAll('[data-e^="t"]').forEach(function (el) {
        el.setAttribute("contenteditable", "plaintext-only");
        if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
        el.setAttribute("spellcheck", "true");
        el.addEventListener("input", function () {
          var src = node(el.getAttribute("data-e"));
          if (!src) return;
          src.innerHTML = sanitizeInline(el);
          clearTimeout(el._t);
          el._t = setTimeout(function () { push(); }, 600);
          scheduleSave();
        });
        el.addEventListener("keydown", function (e) { if (e.key === "Enter" && !/^(P|DIV|LI|TD)$/.test(el.tagName)) { e.preventDefault(); el.blur(); } });
      });
      root.querySelectorAll("[data-source], [data-draw]").forEach(function (el) {
        if (!el.closest('[data-e^="t"]')) el.setAttribute("title", T.editWritten);
      });
    }
    function card(el) { var c = el && el.closest && el.closest('[data-e^="c"]'); return c && api.root.contains(c) ? c : null; }
    function toolbar(c) {
      if (tools) { tools.remove(); tools = null; }
      if (!c) return;
      var r = c.getBoundingClientRect();
      tools = h("div", { "class": "dash-edit-tools", style: "left:" + Math.max(8, r.right - 140) + "px;top:" + Math.max(52, r.top - 34) + "px" }, [
        kit.button("", "prev", function () { move(c, -1); }, T.editEarlier),
        kit.button("", "next", function () { move(c, 1); }, T.editLater),
        kit.button("", "trash", function () { remove(c); }, T.editDelete)
      ]);
      document.body.appendChild(tools);
    }
    function sib(el, d) { var s = d < 0 ? el.previousElementSibling : el.nextElementSibling; while (s && s.matches("script, style, template")) s = d < 0 ? s.previousElementSibling : s.nextElementSibling; return s; }
    function move(c, d) {
      var src = node(c.getAttribute("data-e")), s = src && sib(src, d);
      if (!s) { kit.toast(d < 0 ? T.editFirst : T.editLast); return; }
      if (d < 0) s.parentNode.insertBefore(src, s); else s.parentNode.insertBefore(s, src);
      var live = sib(c, d);
      if (live) { if (d < 0) live.parentNode.insertBefore(c, live); else live.parentNode.insertBefore(live, c); }
      push(); scheduleSave(); toolbar(c); api.redraw();
    }
    function remove(c) {
      var src = node(c.getAttribute("data-e"));
      if (!src) return;
      src.remove(); c.remove(); toolbar(null);
      push(); scheduleSave(); api.redraw();
      kit.toast(T.editDeleted);
    }
    function undo() { if (at <= 0) { kit.toast(T.editNothingUndo); return; } at--; load(stack[at]); scheduleSave(); }
    function redo() { if (at >= stack.length - 1) { kit.toast(T.editNothingRedo); return; } at++; load(stack[at]); scheduleSave(); }
    function showBar() {
      if (!on) { if (barEl) { barEl.remove(); barEl = null; } return; }
      var box = h("div", { "class": "dash-notice dash-edit-bar" }, [
        h("b", { text: T.editorMode }), h("span", { style: "flex:1;min-width:0", text: status || T.editEvery }),
        kit.button("", "undo", undo, T.draftUndo), kit.button("", "redo", redo, T.draftRedo),
        kit.labelled(kit.button(T.editDone, "", stop), T.editDone)
      ]);
      if (barEl) barEl.replaceWith(box); else api.root.parentNode.insertBefore(box, api.root);
      barEl = box;
    }
    function onClick(e) { if (on) toolbar(card(e.target)); }
    function onKey(e) {
      if (!on) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.target.isContentEditable) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (e.key === "Escape") stop();
    }
    function start() {
      if (on) return;
      if (!api.isLatest()) { kit.toast(T.editLatestFirst); return; }
      var p = api.pagePath();
      var html = p ? kit.fileText(p) : null;
      if (html == null) {
        if (window.hermes && window.hermes.send) window.hermes.send(T.editAskMsg, { editable: false }).then(function () { kit.toast(T.staged); }, function () {});
        kit.toast(T.editNeedsPage);
        return;
      }
      if (!window.hermes || !window.hermes.save) { kit.toast(T.noBridge); return; }
      on = true; path = p; status = "";
      tpl = document.createElement("template");
      tpl.innerHTML = html;
      annotate(tpl);
      stack = [source()]; at = 0;
      document.documentElement.setAttribute("data-dash-editing", "1");
      api.remount(source());
      decorate();
      showBar();
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
    }
    function stop() {
      if (!on) return;
      on = false; toolbar(null);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.documentElement.removeAttribute("data-dash-editing");
      clearTimeout(timer);
      var finish = function () { showBar(); if (window.hermes && window.hermes.history) window.hermes.history.show(null, null); };
      if (saving || status === T.editSaving) { var w = setInterval(function () { if (!saving) { clearInterval(w); finish(); } }, 200); save(); } else finish();
    }
    return { start: start, stop: stop, editing: function () { return on; } };
  }
  window.dashEditKit = { init: init };
})();
