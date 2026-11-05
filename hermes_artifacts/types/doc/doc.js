/* hermes-artifacts Doc runtime.
 *
 * Content: doc.md (Markdown), plus any images it names by relative path.
 * Read it, edit it (Markdown beside a live preview, Save makes a new version), and export it to Word
 * (.docx), PDF, Markdown and HTML. fflate and pdf-lib load on demand through the bridge.
 */
(function () {
  "use strict";
  var kit = window.kit, h = kit.h, C = kit.content, md = window.md;
  var L = /^hu\b/i.test(kit.content.lang || navigator.language || "") ? "hu" : "en";
  var T = {
    en: { edit: "Edit", done: "Done", save: "Save", saving: "Saving…", saved: "Saved", exp: "Export", docx: "Word (.docx)",
      pdf: "PDF", mdf: "Markdown (.md)", html: "Web page (HTML)", conflict: "Changed meanwhile: reload to see the new version",
      noSave: "Can't save here", unsaved: "Unsaved changes", building: "Building…", noLib: "The export library didn't load (open the doc in Hermes Desktop)",
      empty: "This doc is empty." },
    hu: { edit: "Szerkesztés", done: "Kész", save: "Mentés", saving: "Mentés…", saved: "Elmentve", exp: "Exportálás", docx: "Word (.docx)",
      pdf: "PDF", mdf: "Markdown (.md)", html: "Weboldal (HTML)", conflict: "Közben megváltozott: töltsd újra az új verzióért",
      noSave: "Itt nem lehet menteni", unsaved: "Nem mentett változások", building: "Készül…", noLib: "Az export könyvtár nem töltődött be (nyisd meg a Hermes Desktopban)",
      empty: "Ez a dokumentum üres." }
  }[L];

  var bar = document.getElementById("doc-bar"), page = document.getElementById("doc-page"), toc = document.getElementById("doc-toc");
  var editBox = document.getElementById("doc-edit"), src = document.getElementById("doc-src");
  bar.className = "kit-bar";
  var text = kit.fileText("doc.md") || "", saved = text, ast = [];

  function imgSrc(p) { return /^data:image\//.test(p) ? p : kit.fileUrl(p) || ""; }
  function title() {
    var h1 = ast.find(function (b) { return b.t === "h" && b.level === 1; });
    return (h1 && md.plain(h1.c)) || C.title || "Doc";
  }

  function render() {
    ast = md.parse(text);
    page.innerHTML = ast.length ? md.html(ast, imgSrc) : '<p class="kit-empty">' + kit.esc(T.empty) + "</p>";
    toc.replaceChildren.apply(toc, Array.prototype.map.call(page.querySelectorAll("h1,h2,h3"), function (el) {
      return h("a", { href: "#" + el.id, "class": "l" + el.tagName[1], text: el.textContent,
        onclick: function (e) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "start" }); } });
    }));
    titleEl.textContent = title();
  }

  // ------------------------------------------------------------------ edit / save
  var editing = false;
  function setEditing(on) {
    editing = on;
    editBox.hidden = !on;
    document.documentElement.toggleAttribute("data-editing", on);
    kit.labelled(editBtn, on ? T.done : T.edit);
    editBtn.setAttribute("aria-pressed", String(on));
    if (on) { src.value = text; src.focus(); }
  }
  var timer = null;
  src.addEventListener("input", function () {
    text = src.value;
    saveBtn.hidden = text === saved;
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  src.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
    if (e.key === "Tab") { e.preventDefault(); var s = src.selectionStart; src.setRangeText("  ", s, src.selectionEnd, "end"); src.dispatchEvent(new Event("input")); }
  });
  function save() {
    if (text === saved) return;
    if (!window.hermes || !window.hermes.save) return kit.toast(T.noSave);
    saveBtn.textContent = T.saving;
    window.hermes.save({ "doc.md": text }, C.version).then(function (r) {
      if (r && r.conflict) return kit.toast(T.conflict);
      saved = text; C.version = r.version; saveBtn.hidden = true; kit.toast(T.saved);
    }).catch(function (e) { kit.toast(String(e && e.message || e)); }).then(function () { saveBtn.textContent = T.save; });
  }
  window.addEventListener("beforeunload", function (e) { if (text !== saved) { e.preventDefault(); e.returnValue = T.unsaved; } });

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
      page.innerHTML + "</article></body></html>";
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
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="' + (L === "hu" ? "hu-HU" : "en-US") + '"/></w:rPr></w:rPrDefault>' +
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
    probe.innerHTML = page.innerHTML;
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
  var saveBtn = kit.labelled(kit.button(T.save, "", save, T.save), T.save);
  saveBtn.classList.add("doc-dirty"); saveBtn.hidden = true;
  var editBtn = kit.labelled(kit.button(T.edit, "notes", function () { setEditing(!editing); }, T.edit), T.edit);
  var exportList = [{ id: "docx", label: T.docx, run: exportDocx }, { id: "pdf", label: T.pdf, run: exportPdf },
    { id: "md", label: T.mdf, run: function () { kit.download(kit.slug(title()) + ".md", text, "text/markdown"); } },
    { id: "html", label: T.html, run: exportHtml }];
  var expBtn = kit.labelled(kit.button(T.exp, "download", function () {
    kit.menu(expBtn, exportList.map(function (x) { return { label: x.label, onClick: x.run }; }));
  }), T.exp);
  expBtn.hidden = true;
  kit.exports(exportList).then(function (hosted) { expBtn.hidden = hosted; });
  bar.append(titleEl, saveBtn, editBtn, expBtn);
  if (C.thumb) editBtn.hidden = true;

  render();
  kit.ready();
})();
