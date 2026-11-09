/* A small CommonMark-ish Markdown parser for the Doc type: headings, paragraphs, emphasis, code, links,
 * images, lists (nested, ordered, tasks), block quotes, fenced code, GFM tables, rules. Raw HTML is
 * shown as text. Produces an AST that both the HTML view and the DOCX writer read. window.md.
 *
 * Doc extras (each readable as plain text elsewhere):
 *   {{date:2026-11-20}}  a date chip          {{@Anna}}  a mention
 *   {{select:Status=Done}}  a dropdown chip (options per name, kept with the doc)
 *   [words]{.underline .red .bg-yellow}  underline, a text colour, a highlight colour
 *   ==words==  highlighted          ```latex / csv / chart / svg  shown as widgets (the page's choice) */
(function () {
  "use strict";

  function parseInline(src) {
    var out = [], i = 0, buf = "";
    function flush() { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } }
    while (i < src.length) {
      var c = src[i], rest = src.slice(i), m;
      if (c === "\\" && i + 1 < src.length && /[\\`*_{}\[\]()#+\-.!|~>=]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
      if (c === "`" && (m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest))) { flush(); out.push({ t: "code", v: m[2].replace(/^ (.*) $/, "$1") }); i += m[0].length; continue; }
      if (c === "!" && (m = /^!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)/.exec(rest))) { flush(); out.push({ t: "img", src: m[2], alt: m[1], title: m[3] }); i += m[0].length; continue; }
      if (c === "[" && (m = /^\[((?:[^\[\]]|\[[^\]]*\])*)\]\{((?:\s*\.[a-z][\w-]*)+)\s*\}/.exec(rest))) {
        flush(); out.push({ t: "span", cls: m[2].trim().split(/\s+/).map(function (x) { return x.slice(1); }), c: parseInline(m[1]) }); i += m[0].length; continue;
      }
      if (c === "[" && (m = /^\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*<?([^\s)>]+)>?(?:\s+"([^"]*)")?\s*\)/.exec(rest))) { flush(); out.push({ t: "link", href: m[2], c: parseInline(m[1]) }); i += m[0].length; continue; }
      if (c === "<" && (m = /^<(https?:\/\/[^\s>]+|mailto:[^\s>]+)>/.exec(rest))) { flush(); out.push({ t: "link", href: m[1], c: [{ t: "text", v: m[1] }] }); i += m[0].length; continue; }
      if ((c === "*" || c === "_") && (m = (c === "*" ? /^\*\*(?=\S)([\s\S]*?\S)\*\*/ : /^__(?=\S)([\s\S]*?\S)__(?!\w)/).exec(rest))) { flush(); out.push({ t: "strong", c: parseInline(m[1]) }); i += m[0].length; continue; }
      if ((c === "*" || c === "_") && (m = (c === "*" ? /^\*(?=\S)([\s\S]*?\S)\*(?!\*)/ : /^_(?=\S)([\s\S]*?\S)_(?!\w)/).exec(rest)) && !(c === "_" && /\w/.test(src[i - 1] || ""))) { flush(); out.push({ t: "em", c: parseInline(m[1]) }); i += m[0].length; continue; }
      if (c === "~" && (m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) { flush(); out.push({ t: "del", c: parseInline(m[1]) }); i += m[0].length; continue; }
      if (c === "=" && (m = /^==(?=\S)([\s\S]*?\S)==/.exec(rest))) { flush(); out.push({ t: "mark", c: parseInline(m[1]) }); i += m[0].length; continue; }
      if (c === "{" && (m = /^\{\{(?:date:(\d{4}-\d{2}-\d{2})|@([^{}\n]{1,80})|select:([^{}=\n]{1,60})=([^{}\n]{0,80}))\}\}/.exec(rest))) {
        flush();
        out.push(m[1] ? { t: "chip", kind: "date", v: m[1] } : m[2] ? { t: "chip", kind: "mention", v: m[2].trim() } :
          { t: "chip", kind: "select", name: m[3].trim(), v: m[4].trim() });
        i += m[0].length; continue;
      }
      if (c === "\n") { if (/ {2,}$/.test(buf) || buf.slice(-1) === "\\") { buf = buf.replace(/ +$|\\$/, ""); flush(); out.push({ t: "br" }); } else buf += " "; i++; continue; }
      if (c === "h" && (m = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(rest)) && !/\w/.test(src[i - 1] || "")) { flush(); out.push({ t: "link", href: m[0], c: [{ t: "text", v: m[0] }] }); i += m[0].length; continue; }
      buf += c; i++;
    }
    flush();
    return out;
  }

  function splitRow(line) {
    var s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    var cells = [], cur = "", esc = false, code = false;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (esc) { cur += c; esc = false; continue; }
      if (c === "\\") { esc = true; cur += c; continue; }
      if (c === "`") code = !code;
      if (c === "|" && !code) { cells.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function parseBlocks(lines) {
    var out = [], i = 0;
    function isBlank(l) { return !l || !l.trim(); }
    while (i < lines.length) {
      var line = lines[i], m;
      if (isBlank(line)) { i++; continue; }
      if ((m = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*).*$/.exec(line))) {
        var fence = m[1], body = []; i++;
        while (i < lines.length && !new RegExp("^ {0,3}" + fence[0] + "{" + fence.length + ",}\\s*$").test(lines[i])) body.push(lines[i++]);
        i++;
        out.push({ t: "code", lang: m[2] || "", v: body.join("\n") });
        continue;
      }
      if ((m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { out.push({ t: "h", level: m[1].length, c: parseInline(m[2]) }); i++; continue; }
      if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ t: "hr" }); i++; continue; }
      if (/^ {0,3}>/.test(line)) {
        var q = [];
        while (i < lines.length && !isBlank(lines[i]) && (/^ {0,3}>/.test(lines[i]) || q.length)) { q.push(lines[i].replace(/^ {0,3}> ?/, "")); i++; }
        out.push({ t: "quote", c: parseBlocks(q) });
        continue;
      }
      if (line.indexOf("|") >= 0 && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        var sepWidths = splitRow(lines[i + 1]).map(function (a) { var n = (a.match(/-/g) || []).length; return n >= 12 ? "extra" : n >= 9 ? "wide" : n >= 6 ? "medium" : n >= 4 ? "narrow" : null; });
        var head = splitRow(line), align = splitRow(lines[i + 1]).map(function (a) {
          return /^:-+:$/.test(a) ? "center" : /-:$/.test(a) ? "right" : /^:-/.test(a) ? "left" : null; });
        i += 2;
        var rows = [];
        while (i < lines.length && !isBlank(lines[i]) && lines[i].indexOf("|") >= 0) rows.push(splitRow(lines[i++]));
        // a column's width rides the dashes of its separator: --- auto, ---- narrow, ------ medium, --------- wide, ------------ extra wide
        out.push({ t: "table", align: align, widths: sepWidths, head: head.map(parseInline), rows: rows.map(function (r) {
          var cells = []; for (var k = 0; k < head.length; k++) cells.push(parseInline(r[k] || "")); return cells; }) });
        continue;
      }
      if ((m = /^( {0,3})([-+*]|\d{1,9}[.)])\s+/.exec(line))) {
        var ordered = /\d/.test(m[2]), start = ordered ? parseInt(m[2], 10) : 1, items = [];
        var marker = ordered ? /^( {0,3})(\d{1,9}[.)])(\s+)(.*)$/ : /^( {0,3})([-+*])(\s+)(.*)$/;
        while (i < lines.length) {
          var lm = marker.exec(lines[i]);
          if (!lm) break;
          var indent = lm[1].length + lm[2].length + Math.min(lm[3].length, 4), body2 = [lm[4]]; i++;
          while (i < lines.length) {
            var l2 = lines[i];
            if (isBlank(l2)) {
              var nx = lines[i + 1];
              if (nx !== undefined && /^\s+/.test(nx) && nx.search(/\S/) >= indent) { body2.push(""); i++; continue; }
              break;
            }
            if (l2.search(/\S/) >= indent) { body2.push(l2.slice(indent)); i++; continue; }
            if (marker.test(l2) || /^ {0,3}([-+*]|\d{1,9}[.)])\s+/.test(l2)) break;
            if (/^ {0,3}(#{1,6}\s|>|```|~~~)/.test(l2)) break;
            body2.push(l2); i++; // lazy continuation
          }
          var item = { c: null };
          var tm = /^\[([ xX])\](\s+|$)/.exec(body2[0]);
          if (tm) { item.task = true; item.checked = tm[1] !== " "; body2[0] = body2[0].slice(tm[0].length); }
          item.c = parseBlocks(body2);
          items.push(item);
          if (i < lines.length && isBlank(lines[i]) && marker.test(lines[i + 1] || "")) i++;
        }
        out.push({ t: "list", ordered: ordered, start: start, items: items });
        continue;
      }
      var para = [];
      while (i < lines.length && !isBlank(lines[i]) && !/^ {0,3}(#{1,6}\s|>|```|~~~|([-*_])(\s*\2){2,}\s*$)/.test(lines[i]) &&
        !(para.length && /^ {0,3}([-+*]|1[.)])\s+/.test(lines[i]))) para.push(lines[i++]);
      if (i < lines.length && para.length === 1 && /^ {0,3}(=+|-+)\s*$/.test(lines[i])) {
        out.push({ t: "h", level: lines[i].trim()[0] === "=" ? 1 : 2, c: parseInline(para[0].trim()) }); i++; continue;
      }
      if (!para.length) { para.push(lines[i++]); }
      out.push({ t: "p", c: parseInline(para.join("\n").trim()) });
    }
    return out;
  }

  function parse(text) {
    return parseBlocks(String(text || "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function safeHref(u) { return /^(https?:|mailto:|#)/i.test(u) ? u : "#"; }
  var COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"];
  function spanClass(cls) {
    return cls.filter(function (c) { return c === "underline" || c === "sug-ins" || c === "sug-del" || COLORS.indexOf(c) >= 0 || COLORS.indexOf(c.replace(/^bg-/, "")) >= 0; })
      .map(function (c) { return "md-" + c; }).join(" ");
  }
  function chipText(n, fmtDate) {
    if (n.kind === "date") return fmtDate ? fmtDate(n.v) : n.v;
    if (n.kind === "mention") return "@" + n.v;
    return n.v;
  }
  function plain(nodes) { return (nodes || []).map(function (n) { return n.t === "chip" ? chipText(n) : n.v != null ? n.v : n.c ? plain(n.c) : n.alt || ""; }).join(""); }
  function slug(s) { return plain(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section"; }

  // opts: {chip(n) -> html} for the live doc's chips (else they are plain words).
  var O = {};
  function inlineHtml(nodes, src) {
    return nodes.map(function (n) {
      switch (n.t) {
        case "text": return esc(n.v);
        case "mark": return "<mark>" + inlineHtml(n.c, src) + "</mark>";
        case "span": var k = spanClass(n.cls); return k ? '<span class="' + k + '">' + inlineHtml(n.c, src) + "</span>" : inlineHtml(n.c, src);
        case "chip": return O.chip ? O.chip(n) : esc(chipText(n, O.date));
        case "code": return "<code>" + esc(n.v) + "</code>";
        case "strong": return "<strong>" + inlineHtml(n.c, src) + "</strong>";
        case "em": return "<em>" + inlineHtml(n.c, src) + "</em>";
        case "del": return "<del>" + inlineHtml(n.c, src) + "</del>";
        case "br": return "<br>";
        case "link": return '<a href="' + esc(safeHref(n.href)) + '" target="_blank" rel="noopener noreferrer">' + inlineHtml(n.c, src) + "</a>";
        case "img": return '<img src="' + esc(src ? src(n.src) || "" : n.src) + '" data-src="' + esc(n.src) + '" alt="' + esc(n.alt) + '"' + (n.title ? ' title="' + esc(n.title) + '"' : "") + ">";
      }
      return "";
    }).join("");
  }

  function html(ast, src, opts) {
    var seen = {}, was = O;
    O = opts || {};
    try { return htmlOf(ast, src, seen); } finally { O = was; }
  }
  function htmlOf(ast, src, seen) {
    return ast.map(function blk(b) {
      switch (b.t) {
        case "h":
          var id = slug(b.c); if (seen[id]) id += "-" + (++seen[id]); else seen[id] = 1;
          return "<h" + b.level + ' id="' + esc(id) + '">' + inlineHtml(b.c, src) + "</h" + b.level + ">";
        case "p": return "<p>" + inlineHtml(b.c, src) + "</p>";
        case "hr": return "<hr>";
        case "code":
          var w = O.widget && O.widget(b.lang, b.v);
          return w || '<pre><code data-lang="' + esc(b.lang) + '">' + esc(b.v) + "</code></pre>";
        case "quote": return "<blockquote>" + b.c.map(blk).join("") + "</blockquote>";
        case "list":
          var tag = b.ordered ? "ol" : "ul";
          return "<" + tag + (b.ordered && b.start !== 1 ? ' start="' + b.start + '"' : "") + ">" + b.items.map(function (it) {
            var inner = it.c.length === 1 && it.c[0].t === "p" ? inlineHtml(it.c[0].c, src) : it.c.map(blk).join("");
            return it.task ? '<li class="task' + (it.checked ? " done" : "") + '"><input type="checkbox"' + (O.live ? "" : " disabled") + (it.checked ? " checked" : "") + ">" + inner + "</li>" : "<li>" + inner + "</li>";
          }).join("") + "</" + tag + ">";
        case "table":
          var al = function (k) { return b.align[k] ? ' style="text-align:' + b.align[k] + '"' : ""; };
          var cw = function (k) { return b.widths && b.widths[k] ? ' class="cw-' + b.widths[k] + '"' : ""; };
          return "<table><thead><tr>" + b.head.map(function (c, k) { return "<th" + cw(k) + al(k) + ">" + inlineHtml(c, src) + "</th>"; }).join("") +
            "</tr></thead><tbody>" + b.rows.map(function (r) { return "<tr>" + r.map(function (c, k) { return "<td" + al(k) + ">" + inlineHtml(c, src) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table>";
      }
      return "";
    }).join("\n");
  }

  window.md = { parse: parse, parseInline: parseInline, html: html, inline: function (nodes, src, opts) {
    var was = O; O = opts || {}; try { return inlineHtml(nodes, src); } finally { O = was; } }, plain: plain, slug: slug, chipText: chipText, COLORS: COLORS };
})();
