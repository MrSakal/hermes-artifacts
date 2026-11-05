/* hermes-artifacts Slides runtime.
 *
 * Content (the artifact's files):
 *   deck.json          {title, order: [slide ids], cover?: id, faces?: {key: {family, href}}}
 *   slides/<id>.html   exactly one <section id="<id>" style="..."> on a 1920x1080 canvas; speaker
 *                      notes in one <aside> (its last child); data-transition="fade|push" on the section,
 *                      data-build-in="fade|rise|pop" on position:absolute children.
 *
 * View, edit text in place (double-click, then Save: a new version), present, and export to PDF, PPTX,
 * PNG and HTML. Export libraries (PptxGenJS, pdf-lib) load on demand through the bridge.
 */
(function () {
  "use strict";
  var kit = window.kit, h = kit.h, C = kit.content;
  var W = 1920, H = 1080;
  var L = /^hu\b/i.test(navigator.language || "") ? "hu" : "en";
  var T = {
    en: { present: "Present", grid: "All slides", notes: "Notes", exp: "Export", pdf: "PDF", pptx: "PowerPoint (.pptx)",
      png: "This slide (PNG)", html: "Web page (HTML)", save: "Save", saving: "Saving…", saved: "Saved",
      conflict: "Changed meanwhile: reload to see the new version", noSave: "Can't save here", editHint: "Double-click text to edit",
      building: "Building…", bad: "deck.json is missing or not valid JSON.", empty: "This deck has no slides yet.",
      noLib: "The export library didn't load (open the deck in Hermes Desktop)", of: "of", nonotes: "No notes for this slide." },
    hu: { present: "Vetítés", grid: "Összes dia", notes: "Jegyzetek", exp: "Exportálás", pdf: "PDF", pptx: "PowerPoint (.pptx)",
      png: "Ez a dia (PNG)", html: "Weboldal (HTML)", save: "Mentés", saving: "Mentés…", saved: "Elmentve",
      conflict: "Közben megváltozott: töltsd újra az új verzióért", noSave: "Itt nem lehet menteni", editHint: "Dupla katt a szövegre a szerkesztéshez",
      building: "Készül…", bad: "A deck.json hiányzik, vagy nem érvényes JSON.", empty: "Ebben a diasorban még nincs dia.",
      noLib: "Az export könyvtár nem töltődött be (nyisd meg a Hermes Desktopban)", of: "/", nonotes: "Ehhez a diához nincs jegyzet." }
  }[L];

  var deck = kit.json("deck.json", null);
  var bar = document.getElementById("sl-bar"), rail = document.getElementById("sl-rail");
  var stageWrap = document.getElementById("sl-stage-wrap"), stage = document.getElementById("sl-stage");
  var notesEl = document.getElementById("sl-notes");
  bar.className = "kit-bar";
  if (!deck) { document.body.appendChild(h("div", { "class": "kit-empty", text: T.bad })); return; }

  // ------------------------------------------------------------------ slides
  var DROP = "script,iframe,frame,frameset,object,embed,link,meta,base,form,portal,style";
  function clean(html, id) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    var sec = tpl.content.querySelector("section");
    if (!sec) { sec = document.createElement("section"); sec.id = id; }
    sec.querySelectorAll(DROP).forEach(function (n) { n.remove(); });
    [sec].concat(Array.prototype.slice.call(sec.querySelectorAll("*"))).forEach(function (el) {
      for (var j = el.attributes.length - 1; j >= 0; j--) {
        var a = el.attributes[j];
        if (/^on/i.test(a.name) || (/^(href|src|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
      }
      if (el.tagName === "IMG") {
        var path = el.getAttribute("src") || "";
        var u = kit.fileUrl(path);
        if (u) { el.setAttribute("data-src-path", path); el.setAttribute("src", u); }
      }
      if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    });
    sec.id = id;
    return sec;
  }

  var order = (deck.order || []).filter(function (id) { return /^[A-Za-z0-9_-]{1,64}$/.test(id); });
  Object.keys(C.files).forEach(function (p) {
    var m = /^slides\/([A-Za-z0-9_-]{1,64})\.html$/.exec(p);
    if (m && order.indexOf(m[1]) < 0) order.push(m[1]);
  });
  var slides = order.filter(function (id) { return kit.fileText("slides/" + id + ".html") != null; }).map(function (id) {
    return { id: id, sec: clean(kit.fileText("slides/" + id + ".html"), id), dirty: false };
  });
  function notesOf(s) { var a = s.sec.querySelector("aside"); return a ? a.textContent.trim() : ""; }
  function titleOf(s) { var t = s.sec.querySelector("h1,h2,h3,p"); return t ? t.textContent.trim().slice(0, 60) : s.id; }

  // Fonts the deck names (Google Fonts css2 links only).
  Object.keys(deck.faces || {}).forEach(function (k) {
    var f = deck.faces[k];
    if (f && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(f.href || "")) document.head.appendChild(h("link", { rel: "stylesheet", href: f.href }));
  });

  var cur = 0;
  var start = location.hash.match(/^#slide-(\d+)$/);
  if (start) cur = Math.min(slides.length - 1, Math.max(0, +start[1] - 1));
  if (C.thumb && deck.cover) cur = Math.max(0, slides.findIndex(function (s) { return s.id === deck.cover; }));

  function canvasFor(s, scale, live) {
    var c = h("div", { "class": "sl-canvas" });
    c.style.transform = "scale(" + scale + ")";
    c.appendChild(live ? s.sec : s.sec.cloneNode(true));
    return c;
  }

  // ------------------------------------------------------------------ main view
  function fit() {
    var r = stageWrap.getBoundingClientRect(), pad = C.thumb ? 0 : 48;
    var sc = Math.min((r.width - pad) / W, (r.height - pad) / H);
    if (!(sc > 0)) sc = 0.3;
    stage.style.width = W * sc + "px"; stage.style.height = H * sc + "px";
    var cv = stage.firstChild;
    if (cv) cv.style.transform = "scale(" + sc + ")";
    return sc;
  }

  function show(i) {
    if (!slides.length) return;
    stopEdit();
    cur = Math.max(0, Math.min(slides.length - 1, i));
    stage.replaceChildren(canvasFor(slides[cur], 1, true));
    fit();
    rail.querySelectorAll(".sl-thumb").forEach(function (b, j) { b.classList.toggle("on", j === cur); });
    var on = rail.querySelectorAll(".sl-thumb")[cur];
    if (on) on.scrollIntoView({ block: "nearest" });
    counter.textContent = (cur + 1) + " " + T.of + " " + slides.length;
    notesEl.textContent = notesOf(slides[cur]) || T.nonotes;
    try { history.replaceState(null, "", "#slide-" + (cur + 1)); } catch (e) {}
  }

  function thumb(s, i, caption) {
    var box = h("div", { "class": "sl-box" });
    var b = h("button", { "class": "sl-thumb", type: "button", title: titleOf(s), onclick: function () { closeGrid(); show(i); } },
      [caption ? null : h("span", { "class": "sl-num", text: String(i + 1) }), box,
       caption ? h("span", { "class": "sl-cap", text: (i + 1) + ". " + titleOf(s) }) : null]);
    requestAnimationFrame(function () {
      var w = box.clientWidth || 160;
      box.appendChild(canvasFor(s, w / W, false));
    });
    return b;
  }

  function buildRail() {
    rail.replaceChildren.apply(rail, slides.map(function (s, i) { return thumb(s, i, false); }));
  }

  var gridEl = null;
  function openGrid() {
    if (gridEl) return closeGrid();
    gridEl = h("div", { id: "sl-grid" }, slides.map(function (s, i) { return thumb(s, i, true); }));
    document.body.appendChild(gridEl);
  }
  function closeGrid() { if (gridEl) { gridEl.remove(); gridEl = null; } }

  // ------------------------------------------------------------------ editing (text in place)
  var editing = null;
  var TEXT = "h1,h2,h3,h4,p,li,td,th,span,b,i,u,a,div";
  stage.addEventListener("dblclick", function (e) {
    var el = e.target.closest(TEXT);
    if (!el || el.tagName === "SECTION" || !el.closest("section")) return;
    if (el.tagName === "DIV" && !Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); })) return;
    stopEdit();
    editing = el;
    el.setAttribute("contenteditable", "true");
    el.focus();
  });
  stage.addEventListener("input", function () { slides[cur].dirty = true; saveBtn.hidden = false; });
  stage.addEventListener("keydown", function (e) { if (e.key === "Escape") { stopEdit(); e.stopPropagation(); } }, true);
  function stopEdit() {
    if (!editing) return;
    editing.removeAttribute("contenteditable");
    editing = null;
    if (slides[cur] && slides[cur].dirty) buildRail();
  }

  function serialize(s) {
    var sec = s.sec.cloneNode(true);
    sec.querySelectorAll("[contenteditable]").forEach(function (n) { n.removeAttribute("contenteditable"); });
    sec.querySelectorAll("img").forEach(function (img) {
      // Keep the artifact's own file path instead of the inlined data: URI.
      var orig = img.getAttribute("data-src-path");
      if (orig) img.setAttribute("src", orig);
    });
    return sec.outerHTML + "\n";
  }

  function save() {
    stopEdit();
    var files = {};
    slides.forEach(function (s) { if (s.dirty) files["slides/" + s.id + ".html"] = serialize(s); });
    if (!Object.keys(files).length) return;
    if (!window.hermes || !window.hermes.save) return kit.toast(T.noSave);
    saveBtn.textContent = T.saving;
    window.hermes.save(files, C.version).then(function (r) {
      if (r && r.conflict) { kit.toast(T.conflict); return; }
      slides.forEach(function (s) { s.dirty = false; });
      C.version = r.version;
      saveBtn.hidden = true;
      kit.toast(T.saved);
    }).catch(function (e) { kit.toast(String(e && e.message || e)); })
      .then(function () { saveBtn.textContent = T.save; });
  }

  // ------------------------------------------------------------------ present
  var pres = null;
  function present() {
    stopEdit(); closeGrid();
    var box = h("div", { "class": "sl-pbox" }), count = h("div", { "class": "sl-count" });
    pres = { el: h("div", { id: "sl-present", tabindex: "0" }, [box, count]), box: box, count: count, i: cur, steps: [] };
    document.body.appendChild(pres.el);
    pres.el.focus();
    if (pres.el.requestFullscreen) pres.el.requestFullscreen().catch(function () {});
    var hideTimer;
    pres.el.addEventListener("mousemove", function () {
      pres.el.classList.add("cursor"); clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { pres && pres.el.classList.remove("cursor"); }, 1500);
    });
    pres.el.addEventListener("click", function () { step(1); });
    pres.el.addEventListener("keydown", presKey);
    paint(null);
  }
  function pscale() { return Math.min(innerWidth / W, innerHeight / H); }
  function paint(dir) {
    var s = slides[pres.i], sc = pscale(), box = pres.box;
    box.style.width = W * sc + "px"; box.style.height = H * sc + "px";
    var next = canvasFor(s, sc, false);
    pres.steps = Array.prototype.slice.call(next.querySelectorAll("[data-build-in]"));
    pres.steps.forEach(function (n) { n.setAttribute("data-build-hidden", ""); });
    var old = box.lastChild, kind = old && old.firstChild && old.firstChild.getAttribute("data-transition");
    box.appendChild(next);
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (old && dir && !reduce && next.animate) {
      if (kind === "push") {
        old.animate([{ transform: old.style.transform }, { transform: "translateX(" + (-dir * W * sc) + "px) " + old.style.transform }], { duration: 420, easing: "ease-in-out" });
        next.animate([{ transform: "translateX(" + (dir * W * sc) + "px) " + next.style.transform }, { transform: next.style.transform }], { duration: 420, easing: "ease-in-out" })
          .finished.then(function () { old.remove(); });
      } else {
        next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: kind === "fade" ? 320 : 160, easing: "ease-out" }).finished.then(function () { old.remove(); });
      }
    } else if (old) old.remove();
    pres.count.textContent = (pres.i + 1) + " / " + slides.length;
  }
  function build(n) {
    n.removeAttribute("data-build-hidden");
    if (!n.animate || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var k = (n.getAttribute("data-build-in") || "fade").split(/\s+/)[0];
    var from = k === "rise" ? { opacity: 0, transform: "translateY(40px)" } : k === "pop" ? { opacity: 0, transform: "scale(.85)" } : { opacity: 0 };
    n.animate([from, { opacity: 1, transform: "none" }], { duration: 360, easing: "cubic-bezier(.2,.8,.2,1)" });
  }
  function step(d) {
    if (!pres) return;
    if (d > 0 && pres.steps.length) return build(pres.steps.shift());
    var j = pres.i + d;
    if (j < 0 || j >= slides.length) return;
    pres.i = j; paint(d);
  }
  function presKey(e) {
    var k = e.key;
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].indexOf(k) >= 0 && !(k === " " && e.shiftKey)) { e.preventDefault(); step(1); }
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].indexOf(k) >= 0 || (k === " " && e.shiftKey)) { e.preventDefault(); step(-1); }
    else if (k === "Home") { pres.i = 0; paint(-1); }
    else if (k === "End") { pres.i = slides.length - 1; paint(1); }
    else if (/^[1-9]$/.test(k)) { pres.i = Math.min(slides.length - 1, +k - 1); paint(1); }
    else if (k === "f" || k === "F") { if (document.fullscreenElement) document.exitFullscreen(); else if (pres.el.requestFullscreen) pres.el.requestFullscreen().catch(function () {}); }
    else if (k === "Escape") endPresent();
  }
  function endPresent() {
    if (!pres) return;
    var i = pres.i;
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    pres.el.remove(); pres = null;
    show(i);
  }
  document.addEventListener("fullscreenchange", function () { /* keep presenting in the frame after Esc leaves fullscreen */ });
  window.addEventListener("resize", function () { fit(); if (pres) paint(null); });

  document.addEventListener("keydown", function (e) {
    if (pres || editing || /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); show(cur + 1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); show(cur - 1); }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
  });

  // ------------------------------------------------------------------ export: measuring
  /** Render one slide off-screen at full size, for export. */
  function offscreen(s) {
    var holder = h("div", { style: "position:fixed;left:-30000px;top:0;width:" + W + "px;height:" + H + "px;overflow:hidden" });
    var cv = canvasFor(s, 1, false);
    holder.appendChild(cv);
    document.body.appendChild(holder);
    return { sec: cv.firstChild, done: function () { holder.remove(); } };
  }

  function rgba(c) {
    var m = (c || "").match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    var a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    var hex = p.slice(0, 3).map(function (v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join("").toUpperCase();
    return { hex: hex, transparency: Math.round((1 - a) * 100) };
  }
  function firstColor(bgImage) {
    var m = (bgImage || "").match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);
    if (!m) return null;
    var probe = h("div", { style: "color:" + m[0] });
    document.body.appendChild(probe);
    var c = getComputedStyle(probe).color; probe.remove();
    return rgba(c);
  }

  function svgToPng(svgEl, w, h2) {
    return new Promise(function (resolve) {
      var xml = new XMLSerializer().serializeToString(svgEl);
      if (!/xmlns=/.test(xml)) xml = xml.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w * 2)); c.height = Math.max(1, Math.round(h2 * 2));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        try { resolve(c.toDataURL("image/png")); } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    });
  }

  var IN = 1 / 144; // px -> inches (1920 px = 13.333 in)
  function box(el, origin) {
    var r = el.getBoundingClientRect();
    return { x: (r.left - origin.left) * IN, y: (r.top - origin.top) * IN, w: r.width * IN, h: r.height * IN, px: r };
  }
  function family(cs) { return (cs.fontFamily.split(",")[0] || "Arial").replace(/["']/g, "").trim(); }

  function runsOf(el) {
    var runs = [];
    (function walk(n, link) {
      n.childNodes.forEach(function (c) {
        if (c.nodeType === 3) {
          var t = c.textContent.replace(/\s+/g, " ");
          if (!t) return;
          var cs = getComputedStyle(c.parentElement), col = rgba(cs.color);
          runs.push({ text: t, options: { bold: +cs.fontWeight >= 600, italic: cs.fontStyle === "italic",
            underline: /underline/.test(cs.textDecorationLine) ? { style: "sng" } : undefined,
            color: col ? col.hex : undefined, fontFace: family(cs), fontSize: parseFloat(cs.fontSize) / 2,
            hyperlink: link ? { url: link } : undefined } });
        } else if (c.nodeType === 1 && c.tagName === "BR") runs.push({ text: "", options: { breakLine: true } });
        else if (c.nodeType === 1 && getComputedStyle(c).display !== "none") walk(c, c.tagName === "A" ? c.getAttribute("href") : link);
      });
    })(el, null);
    if (runs.length) { runs[0].text = runs[0].text.replace(/^\s+/, ""); var l = runs[runs.length - 1]; l.text = l.text.replace(/\s+$/, ""); }
    return runs.filter(function (r) { return r.text || r.options.breakLine; });
  }

  function hasOwnText(el) {
    return Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
  }
  var TEXT_BLOCK = /^(H1|H2|H3|H4|H5|H6|P|BLOCKQUOTE|FIGCAPTION|LABEL)$/;

  /** One slide as PPTX shapes: native text, boxes, tables; images and SVG as pictures. */
  async function slideToPptx(pptx, s) {
    var o = offscreen(s), sec = o.sec, origin = sec.getBoundingClientRect();
    var slide = pptx.addSlide(), warn = [];
    try {
      var cs = getComputedStyle(sec);
      var bg = rgba(cs.backgroundColor) || firstColor(cs.backgroundImage) || { hex: "FFFFFF" };
      slide.background = { color: bg.hex };
      var visit = async function (el) {
        var st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || el.tagName === "ASIDE") return;
        var b = box(el, origin);
        if (b.w <= 0 || b.h <= 0) return;
        var tag = el.tagName;
        if (tag !== "SECTION" && tag !== "TABLE" && tag !== "svg") {
          var fill = rgba(st.backgroundColor) || (st.backgroundImage !== "none" ? firstColor(st.backgroundImage) : null);
          var bw = parseFloat(st.borderTopWidth) || 0, line = bw && st.borderTopStyle !== "none" ? rgba(st.borderTopColor) : null;
          if (fill || line) {
            var rad = parseFloat(st.borderTopLeftRadius) || 0;
            slide.addShape(rad ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
              x: b.x, y: b.y, w: b.w, h: b.h,
              fill: fill ? { color: fill.hex, transparency: fill.transparency } : { type: "none" },
              line: line ? { color: line.hex, width: bw * 0.5 } : { type: "none" },
              rectRadius: rad ? Math.min(0.5, rad / Math.min(b.px.width, b.px.height)) : undefined
            });
          }
        }
        if (tag === "IMG") {
          var src = el.currentSrc || el.src;
          if (/^data:image\/(png|jpe?g|gif)/i.test(src)) slide.addImage({ data: src, x: b.x, y: b.y, w: b.w, h: b.h });
          else if (/^data:image\/svg/i.test(src)) {
            var tmp = new Image(); tmp.src = src;
            await tmp.decode().catch(function () {});
            var cnv = document.createElement("canvas"); cnv.width = b.px.width * 2; cnv.height = b.px.height * 2;
            try { cnv.getContext("2d").drawImage(tmp, 0, 0, cnv.width, cnv.height); slide.addImage({ data: cnv.toDataURL("image/png"), x: b.x, y: b.y, w: b.w, h: b.h }); }
            catch (e) { warn.push("image"); }
          } else warn.push("image " + src.slice(0, 40));
          return;
        }
        if (tag.toLowerCase() === "svg") {
          var png = await svgToPng(el, b.px.width, b.px.height);
          if (png) slide.addImage({ data: png, x: b.x, y: b.y, w: b.w, h: b.h }); else warn.push("svg");
          return;
        }
        if (tag === "TABLE") {
          var rows = Array.prototype.map.call(el.rows, function (tr) {
            return Array.prototype.map.call(tr.cells, function (td) {
              var c2 = getComputedStyle(td), col = rgba(c2.color), f = rgba(c2.backgroundColor) || rgba(getComputedStyle(tr).backgroundColor);
              return { text: td.textContent.trim(), options: { bold: +c2.fontWeight >= 600, color: col ? col.hex : undefined,
                fill: f ? { color: f.hex } : undefined, fontFace: family(c2), fontSize: parseFloat(c2.fontSize) / 2,
                align: c2.textAlign === "right" ? "right" : c2.textAlign === "center" ? "center" : "left", valign: "middle" } };
            });
          });
          var first = el.rows[0];
          var colW = first ? Array.prototype.map.call(first.cells, function (td) { return td.getBoundingClientRect().width * IN; }) : undefined;
          slide.addTable(rows, { x: b.x, y: b.y, w: b.w, colW: colW, border: { type: "solid", pt: 0.5, color: "BBBBBB" }, margin: 0.04 });
          return;
        }
        if (tag === "UL" || tag === "OL") {
          var paras = [];
          Array.prototype.forEach.call(el.children, function (li, k) {
            var r = runsOf(li);
            if (!r.length) return;
            r[0].options = Object.assign({}, r[0].options, { bullet: tag === "OL" ? { type: "number" } : true });
            if (k < el.children.length - 1) r[r.length - 1].options = Object.assign({}, r[r.length - 1].options, { breakLine: true });
            paras = paras.concat(r);
          });
          if (paras.length) slide.addText(paras, { x: b.x, y: b.y, w: b.w, h: b.h, valign: "top", margin: 0, fit: "none",
            lineSpacingMultiple: (parseFloat(st.lineHeight) / parseFloat(st.fontSize)) || 1.2 });
          return;
        }
        if (TEXT_BLOCK.test(tag) || (tag !== "SECTION" && hasOwnText(el))) {
          var runs = runsOf(el);
          if (runs.length) {
            var lh = parseFloat(st.lineHeight) / parseFloat(st.fontSize);
            slide.addText(runs, { x: b.x, y: b.y, w: b.w + 0.05, h: b.h, valign: "top", margin: 0, fit: "none", wrap: true,
              align: st.textAlign === "center" ? "center" : st.textAlign === "right" || st.textAlign === "end" ? "right" : "left",
              lineSpacingMultiple: lh > 0.5 && lh < 4 ? lh : undefined });
          }
          return;
        }
        for (var i = 0; i < el.children.length; i++) await visit(el.children[i]);
      };
      await visit(sec);
      var n = notesOf(s);
      if (n) slide.addNotes(n);
    } finally { o.done(); }
    return warn;
  }

  /** One slide as a picture: SVG foreignObject -> canvas. Everything in it is a data: URI. */
  function rasterize(s, scale) {
    return new Promise(function (resolve, reject) {
      var o = offscreen(s);
      var css = Array.prototype.map.call(document.styleSheets, function (ss) {
        try { return Array.prototype.map.call(ss.cssRules, function (r) { return r.cssText; }).join("\n"); } catch (e) { return ""; }
      }).join("\n");
      var node = o.sec.cloneNode(true);
      o.done();
      node.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      var wrap = document.createElement("div");
      wrap.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      wrap.className = "sl-canvas";
      wrap.setAttribute("style", "transform:none;position:relative");
      wrap.appendChild(node);
      var xhtml = new XMLSerializer().serializeToString(wrap);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject width="100%" height="100%">' +
        '<style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[' + css.replace(/]]>/g, "") + ']]></style>' + xhtml + "</foreignObject></svg>";
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = W * scale; c.height = H * scale;
        var g = c.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = function () { reject(new Error("slide picture failed")); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
  }

  var libs = {};
  function lib(name, global) {
    if (window[global]) return Promise.resolve(window[global]);
    if (!window.hermes || !window.hermes.vendor) return Promise.reject(new Error(T.noLib));
    return (libs[name] = libs[name] || window.hermes.vendor(name).then(function (src) {
      (0, eval)(src + "\n//# sourceURL=vendor/" + name);
      if (!window[global]) throw new Error(T.noLib);
      return window[global];
    }));
  }

  function busy(on) {
    var b = document.querySelector(".sl-busy");
    if (on && !b) document.body.appendChild(h("div", { "class": "sl-busy", text: T.building }));
    if (!on && b) b.remove();
  }

  async function exportPptx() {
    busy(true);
    try {
      var PptxGenJS = await lib("pptxgen.bundle.js", "PptxGenJS");
      var pptx = new PptxGenJS();
      pptx.defineLayout({ name: "HERMES16x9", width: W * IN, height: H * IN });
      pptx.layout = "HERMES16x9";
      pptx.title = deck.title || C.title || "Slides";
      var warn = [];
      for (var i = 0; i < slides.length; i++) warn = warn.concat(await slideToPptx(pptx, slides[i]));
      var blob = await pptx.write({ outputType: "blob", compression: true });
      kit.download(kit.slug(pptx.title) + ".pptx", blob, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      if (warn.length) kit.toast(warn.length + " element(s) exported as best effort");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  async function exportPdf() {
    busy(true);
    try {
      var PDFLib = await lib("pdf-lib.min.js", "PDFLib");
      var pdf = await PDFLib.PDFDocument.create();
      pdf.setTitle(deck.title || C.title || "Slides");
      pdf.setCreator("Hermes Artifacts");
      for (var i = 0; i < slides.length; i++) {
        var c = await rasterize(slides[i], 1.5);
        var jpg = await pdf.embedJpg(c.toDataURL("image/jpeg", 0.9));
        var page = pdf.addPage([960, 540]);
        page.drawImage(jpg, { x: 0, y: 0, width: 960, height: 540 });
      }
      var bytes = await pdf.save();
      kit.download(kit.slug(deck.title || C.title) + ".pdf", new Blob([bytes], { type: "application/pdf" }), "application/pdf");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  async function exportPng() {
    busy(true);
    try {
      var c = await rasterize(slides[cur], 1);
      var blob = await new Promise(function (r) { c.toBlob(r, "image/png"); });
      kit.download(kit.slug(deck.title || C.title) + "-" + (cur + 1) + ".png", blob, "image/png");
    } catch (e) { kit.toast(String(e && e.message || e)); } finally { busy(false); }
  }

  function exportHtml() {
    var secs = slides.map(function (s) { var c = s.sec.cloneNode(true); c.querySelectorAll("[contenteditable]").forEach(function (n) { n.removeAttribute("contenteditable"); }); return c.outerHTML; }).join("\n");
    var css = Array.prototype.map.call(document.styleSheets, function (ss) {
      try { return Array.prototype.map.call(ss.cssRules, function (r) { return r.cssText; }).join("\n"); } catch (e) { return ""; }
    }).join("\n");
    var doc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; script-src \'unsafe-inline\'">' +
      "<title>" + kit.esc(deck.title || C.title) + "</title><style>" + css + "body{margin:0;background:#000;overflow:hidden}" +
      ".sl-canvas>section{display:none}.sl-canvas>section.on{display:flex}</style></head><body>" +
      '<div class="sl-canvas" id="c">' + secs + "</div><script>(function(){var c=document.getElementById('c'),s=c.children,i=0;" +
      "function f(){var k=Math.min(innerWidth/1920,innerHeight/1080);c.style.transform='scale('+k+')';c.style.left=(innerWidth-1920*k)/2+'px';c.style.top=(innerHeight-1080*k)/2+'px';}" +
      "function g(n){i=Math.max(0,Math.min(s.length-1,n));for(var j=0;j<s.length;j++)s[j].classList.toggle('on',j===i);}" +
      "addEventListener('resize',f);addEventListener('keydown',function(e){if(/Right|Down|PageDown| /.test(e.key))g(i+1);if(/Left|Up|PageUp/.test(e.key))g(i-1);});" +
      "addEventListener('click',function(){g(i+1)});f();g(0);})();</" + "script></body></html>";
    kit.download(kit.slug(deck.title || C.title) + ".html", doc, "text/html");
  }

  // ------------------------------------------------------------------ chrome
  var counter = h("span", { "class": "src-meta", style: "font-size:12px;color:var(--color-fg-muted);margin-right:4px" });
  var saveBtn = kit.labelled(kit.button(T.save, "", save, T.save), T.save);
  saveBtn.classList.add("sl-save"); saveBtn.hidden = true;
  var expBtn = kit.labelled(kit.button(T.exp, "download", function () {
    kit.menu(expBtn, [{ label: T.pdf, onClick: exportPdf }, { label: T.pptx, onClick: exportPptx },
      { label: T.png, onClick: exportPng }, { label: T.html, onClick: exportHtml }]);
  }), T.exp);
  var notesBtn = kit.button("", "notes", function () {
    notesEl.hidden = !notesEl.hidden; notesBtn.setAttribute("aria-pressed", String(!notesEl.hidden)); fit();
  }, T.notes);
  bar.append(h("span", { "class": "kit-title", text: deck.title || C.title || "Slides", title: T.editHint }), counter, saveBtn,
    kit.button("", "grid", openGrid, T.grid), notesBtn, expBtn,
    kit.labelled(kit.button(T.present, "play", present, T.present), T.present));

  if (!slides.length) { stage.replaceWith(h("div", { "class": "kit-empty", text: T.empty })); return; }
  buildRail();
  show(cur);
  new ResizeObserver(fit).observe(stageWrap);
  kit.ready();
})();
