/* The doc's rich editing: a block is edited as formatted text (contenteditable), and what the person
 * typed is written back as the block's Markdown, so the server, Hermes and the exports keep one
 * format. window.docEdit = { toMd, inlineMd, caret helpers }. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ DOM -> Markdown
  function escText(s, inTable) {
    s = s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\*/g, function (m0, i, all) { return /\s/.test(all[i - 1] || " ") && /\s/.test(all[i + 1] || " ") ? "*" : "\\*"; }).replace(/\[/g, "\\[").replace(/\]/g, "\\]")
      .replace(/~~/g, "\\~\\~").replace(/==/g, "\\=\\=").replace(/\{\{/g, "\\{\\{")
      .replace(/(^|[^\w\\])_/g, "$1\\_");
    if (inTable) s = s.replace(/\|/g, "\\|");
    return s.replace(/\u00a0/g, " ");
  }
  // Markers hug their words: "**bold **" would not parse, so edge spaces go outside them.
  function wrap(inner, open, close) {
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    if (!m[2]) return inner;
    return m[1] + open + m[2] + (close == null ? open : close) + m[3];
  }
  var BLOCK = /^(P|DIV|H[1-6]|UL|OL|LI|BLOCKQUOTE|PRE|TABLE|HR|FIGURE)$/;

  function inlineMd(el, ctx) {
    ctx = ctx || {};
    var out = "";
    el.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { out += escText(n.nodeValue, ctx.table); return; }
      if (n.nodeType !== 1) return;
      if (n.hasAttribute("data-md")) { out += n.getAttribute("data-md"); return; } // a chip, an image: its own source
      if (n.hasAttribute("data-ui") || /^(BUTTON|TEXTAREA|SELECT)$/.test(n.tagName)) return; // controls, never the doc's words
      var tag = n.tagName, inner;
      switch (tag) {
        case "BR": // a line break inside the words; the browser's trailing <br> of a line keeps nothing
          var rest = n.nextSibling; while (rest && rest.nodeType === 3 && !rest.nodeValue.trim()) rest = rest.nextSibling;
          if (rest) out += ctx.table ? " " : "\\\n";
          return;
        case "B": case "STRONG": out += wrap(inlineMd(n, ctx), "**"); return;
        case "I": case "EM": out += wrap(inlineMd(n, ctx), "*"); return;
        case "S": case "DEL": case "STRIKE": out += wrap(inlineMd(n, ctx), "~~"); return;
        case "MARK": out += wrap(inlineMd(n, ctx), "=="); return;
        case "CODE": out += "`" + n.textContent.replace(/`/g, "'") + "`"; return;
        case "U": out += wrap(inlineMd(n, ctx), "[", "]{.underline}"); return;
        case "A":
          inner = inlineMd(n, ctx);
          var href = n.getAttribute("href") || "";
          out += /^(https?:|mailto:|#)/i.test(href) ? "[" + inner + "](" + href.replace(/[()\s]/g, encodeURIComponent) + ")" : inner;
          return;
        case "IMG": out += "![" + (n.getAttribute("alt") || "").replace(/[\[\]]/g, "") + "](" + (n.getAttribute("data-src") || n.getAttribute("src") || "") + ")"; return;
        case "INPUT": return;
        case "SPAN": case "FONT":
          var cls = [];
          (n.className && typeof n.className === "string" ? n.className.split(/\s+/) : []).forEach(function (c) {
            if (/^md-/.test(c)) cls.push(c.slice(3));
          });
          if (n.style && n.style.textDecorationLine === "underline" && cls.indexOf("underline") < 0) cls.push("underline");
          inner = inlineMd(n, ctx);
          out += cls.length ? wrap(inner, "[", "]{" + cls.map(function (c) { return "." + c; }).join(" ") + "}") : inner;
          return;
      }
      if (BLOCK.test(tag)) { var s = inlineMd(n, ctx); out += (out && !/\s$/.test(out) ? " " : "") + s; return; }
      out += inlineMd(n, ctx);
    });
    return out;
  }

  function listMd(el, indent) {
    var ordered = el.tagName === "OL", n = parseInt(el.getAttribute("start") || "1", 10) || 1, lines = [];
    var task = el.hasAttribute("data-task") || !!el.querySelector(":scope > li.task, :scope > li > input[type=checkbox]");
    Array.prototype.forEach.call(el.children, function (li) {
      if (li.tagName !== "LI") return;
      var mark = ordered ? (n++) + ". " : "- ", pad = indent + " ".repeat(mark.length);
      var box = li.querySelector(":scope > input[type=checkbox]");
      var isTask = !ordered && (task || li.classList.contains("task") || box);
      var checked = box ? box.checked : li.classList.contains("done");
      var head = "", rest = [];
      li.childNodes.forEach(function (c) {
        if (c.nodeType === 1 && (c.tagName === "UL" || c.tagName === "OL")) rest.push(listMd(c, pad));
        else if (c.nodeType === 1 && c.tagName === "P") head += (head ? "\\\n" : "") + inlineMd(c);
        else if (c.nodeType === 1 && !c.hasAttribute("data-ui") && c.tagName !== "INPUT") head += c.nodeType === 1 && c.hasAttribute("data-md") ? c.getAttribute("data-md") : inlineMd({ childNodes: [c] });
        else if (c.nodeType === 3) head += escText(c.nodeValue);
      });
      head = head.replace(/^\s+/, "").replace(/\s+$/, "");
      lines.push(indent + mark + (isTask ? (checked ? "[x] " : "[ ] ") : "") + head);
      rest.forEach(function (r) { lines.push(r); });
    });
    return lines.join("\n");
  }

  function tableMd(el) {
    var rows = Array.prototype.filter.call(el.querySelectorAll("tr"), function (tr) { return tr.closest("table") === el; });
    if (!rows.length) return "";
    var grid = rows.map(function (tr) {
      return Array.prototype.filter.call(tr.children, function (c) { return c.tagName === "TD" || c.tagName === "TH"; }).map(function (c) {
        var s = inlineMd(c, { table: true }).replace(/\n+/g, " ").trim();
        var bg = /\bmd-(bg-[a-z]+)\b/.exec(c.className || "");
        if (bg && s && !/\{\.bg-/.test(s)) s = "[" + s + "]{." + bg[1] + "}";
        return s;
      });
    });
    var cols = Math.max.apply(null, grid.map(function (r) { return r.length; }));
    var head = rows[0].children, align = [];
    for (var k = 0; k < cols; k++) {
      var a = head[k] && (head[k].style.textAlign || head[k].getAttribute("align")) || "";
      var w = head[k] && /\bcw-(narrow|medium|wide|extra)\b/.exec(head[k].className || "");
      var dash = "-".repeat(w ? { narrow: 4, medium: 6, wide: 9, extra: 12 }[w[1]] : 3);
      align.push(a === "center" ? ":" + dash + ":" : a === "right" ? dash + ":" : dash);
    }
    var line = function (r) { var c = r.slice(); while (c.length < cols) c.push(""); return "| " + c.join(" | ") + " |"; };
    return [line(grid[0]), "| " + align.join(" | ") + " |"].concat(grid.slice(1).map(line)).join("\n");
  }

  function blocksMd(el) {
    var out = [], para = "";
    function flush() { if (para.trim()) out.push(para.trim()); para = ""; }
    el.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { para += escText(n.nodeValue); return; }
      if (n.nodeType !== 1 || n.hasAttribute("data-ui") || /^(BUTTON|TEXTAREA|SELECT)$/.test(n.tagName)) return;
      var tag = n.tagName;
      if (!BLOCK.test(tag)) { para += n.hasAttribute("data-md") ? n.getAttribute("data-md") : inlineMd({ childNodes: [n] }); return; }
      flush();
      var m;
      if ((m = /^H([1-6])$/.exec(tag))) out.push("#".repeat(+m[1]) + " " + inlineMd(n).trim());
      else if (tag === "P") { var s = inlineMd(n).trim(); if (s) out.push(s); }
      else if (tag === "DIV") { var inner = blocksMd(n); if (inner) out.push(inner); }
      else if (tag === "UL" || tag === "OL") out.push(listMd(n, ""));
      else if (tag === "BLOCKQUOTE") out.push(blocksMd(n).split("\n").map(function (l) { return "> " + l; }).join("\n"));
      else if (tag === "PRE") {
        var code = n.querySelector("code") || n, lang = code.getAttribute("data-lang") || "";
        var body = code.textContent.replace(/\n$/, ""), fence = /```/.test(body) ? "~~~~" : "```";
        out.push(fence + lang + "\n" + body + "\n" + fence);
      }
      else if (tag === "TABLE") out.push(tableMd(n));
      else if (tag === "HR") out.push("---");
      else if (tag === "FIGURE") out.push(blocksMd(n));
    });
    flush();
    return out.filter(Boolean).join("\n\n");
  }

  // ------------------------------------------------------------------ caret helpers
  function caretRange() {
    var s = window.getSelection();
    return s && s.rangeCount ? s.getRangeAt(0) : null;
  }
  function placeCaret(el, atEnd) {
    var r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!atEnd);
    var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  /** Is the caret at the very start (or end) of el's text? */
  function caretAt(el, end) {
    var r = caretRange();
    if (!r || !r.collapsed || !el.contains(r.startContainer)) return false;
    var probe = document.createRange();
    probe.selectNodeContents(el);
    if (end) probe.setStart(r.endContainer, r.endOffset); else probe.setEnd(r.startContainer, r.startOffset);
    return probe.toString().replace(/\u200b/g, "") === "" && !probe.cloneContents().querySelector("img,[data-md]");
  }
  /** The caret's line: first or last line of el (for moving between blocks with the arrows). */
  function caretLine(el, last) {
    var r = caretRange();
    if (!r || !el.contains(r.startContainer)) return false;
    var rects = r.getClientRects(), box = el.getBoundingClientRect();
    var rc = rects.length ? rects[0] : null;
    if (!rc) { // an empty line: use a temporary marker
      var span = document.createElement("span"); span.textContent = "\u200b";
      r.insertNode(span); rc = span.getBoundingClientRect(); span.remove();
    }
    var lh = parseFloat(getComputedStyle(el).lineHeight) || 24;
    return last ? rc.bottom > box.bottom - lh * 0.9 : rc.top < box.top + lh * 0.9;
  }
  /** Split el at the caret: returns a fragment of what follows the caret (removed from el). */
  function splitAtCaret(el) {
    var r = caretRange();
    if (!r) return document.createDocumentFragment();
    if (!r.collapsed) r.deleteContents();
    var tail = document.createRange();
    tail.setStart(r.startContainer, r.startOffset);
    tail.setEnd(el, el.childNodes.length);
    return tail.extractContents();
  }

  window.docEdit = { toMd: blocksMd, inlineMd: inlineMd,
    caretRange: caretRange, placeCaret: placeCaret, caretAt: caretAt, caretLine: caretLine, splitAtCaret: splitAtCaret };
})();
