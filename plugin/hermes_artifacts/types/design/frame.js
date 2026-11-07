/* The artboard side of the design canvas. Runs inside each artboard's frame: a srcdoc iframe of the
 * design runtime, which is a document (and an origin) of its own, so an artboard's script never
 * reaches the page's bridge. It renders one .dc.html with DC (dc.js) and talks to the canvas over
 * postMessage: selection, hover, text edits typed in place, wheel and pan gestures, Play links,
 * pictures for export. Booted by an "init" message; or, in a standalone HTML export, from #dc-standalone.
 */
(function () {
  "use strict";
  var DC = window.DC, kit = window.kit;
  var standalone = document.getElementById("dc-standalone");
  var st = { id: null, file: null, sources: {}, parsed: {}, urls: {}, css: {}, props: {}, propsAll: {}, mode: "edit", wheel: "forward",
    inst: null, map: new WeakMap(), sel: [], editing: null, editStart: "", space: false, errors: [], hover: null, ready: false };

  function post(m) {
    if (standalone || window.parent === window) return;
    m.__dc = 1; m.id = st.id;
    try { window.parent.postMessage(m, "*"); } catch (e) {}
  }

  // ------------------------------------------------------------------ files
  function dir(p) { return p && p.indexOf("/") >= 0 ? p.slice(0, p.lastIndexOf("/") + 1) : ""; }
  function norm(p) {
    var out = [];
    p.split("/").forEach(function (s) { if (s === "..") out.pop(); else if (s && s !== ".") out.push(s); });
    return out.join("/");
  }
  function resolvePath(ref, file) {
    var clean = String(ref || "").trim().split("#")[0].split("?")[0];
    if (!clean || /^(data:|blob:|[a-z][a-z0-9+.-]*:|\/\/)/i.test(clean)) return null;
    return clean.charAt(0) === "/" ? norm(clean.slice(1)) : norm(dir(file) + clean);
  }
  function url(ref, file) {
    var p = resolvePath(ref, file);
    if (p == null) return null;
    if (st.urls[p]) return st.urls[p];
    var q = String(ref).replace(/^(\.{1,2}\/)+/, "").split("?")[0];
    return st.urls[q] || null;
  }
  function css(ref, file) {
    var p = resolvePath(ref, file);
    return p != null && st.css[p] != null ? st.css[p] : null;
  }
  function get(path) {
    if (st.parsed[path]) return st.parsed[path];
    if (st.sources[path] == null) return null;
    return (st.parsed[path] = DC.parse(st.sources[path]));
  }

  // ------------------------------------------------------------------ render
  function live() { return st.mode !== "edit" && st.mode !== "export"; }
  function fail(err) {
    var msg = String(err && err.message || err).slice(0, 400);
    if (st.errors.indexOf(msg) < 0) st.errors.push(msg);
    post({ t: "error", errors: st.errors.slice(0, 10) });
    if (standalone) console.error(err);
  }
  function headLinks(parsed) {
    document.head.querySelectorAll("[data-dc-head]").forEach(function (n) { n.remove(); });
    (parsed.head.links || []).forEach(function (href) {
      var n = null;
      if (/^https:\/\/fonts\.googleapis\.com\/css2?\?/.test(href)) {
        n = document.createElement("link"); n.rel = "stylesheet"; n.href = href; n.crossOrigin = "anonymous";
      } else {
        var c = css(href, st.file);
        if (c != null) {
          n = document.createElement("style");
          n.textContent = c.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, function (m, q, ref) {
            var u = url(ref, resolvePath(href, st.file) || st.file); return u ? 'url("' + u + '")' : m;
          });
        }
      }
      if (n) { n.setAttribute("data-dc-head", ""); document.head.appendChild(n); }
    });
  }
  function mount() {
    if (st.inst) st.inst.unmount();
    st.errors = []; st.map = new WeakMap();
    document.body.replaceChildren();
    var parsed = get(st.file);
    if (!parsed) { fail(new Error("no file " + st.file)); return; }
    document.documentElement.lang = parsed.head.lang || "en";
    document.title = parsed.head.title || st.file;
    headLinks(parsed);
    if (parsed.missing) fail(new Error("no <x-dc> in " + st.file));
    if (parsed.propsError) fail(new Error(parsed.propsError));
    st.inst = DC.mount({ doc: document, host: document.body, file: st.file, parsed: parsed, get: get, props: st.props, url: url, css: css,
      live: live, map: st.map, onError: fail, onRender: rendered });
    if (!st.errors.length) post({ t: "error", errors: [] });
    if (!st.ready) settle().then(function () { st.ready = true; post({ t: "ready" }); size(); });
  }
  var selTimer = 0;
  function rendered() {
    if (selTimer) return;
    selTimer = setTimeout(function () { selTimer = 0; if (st.sel.length) sendSel(); size(); }, 16);
  }
  var lastH = 0;
  function size() {
    var h = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
    if (h !== lastH) { lastH = h; post({ t: "size", h: h }); }
  }
  function settle() {
    var imgs = Array.prototype.map.call(document.images, function (i) { return i.decode ? i.decode().catch(function () {}) : 0; });
    // A frame the browser isn't drawing may never finish decoding: wait 4 s at most.
    var all = Promise.all([document.fonts ? document.fonts.ready : 0].concat(imgs));
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 4000); })]).then(function () {
      // Two frames; a frame out of view may get no animation frames at all, so a timer too.
      return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); setTimeout(r, 120); });
    });
  }

  // ------------------------------------------------------------------ selection
  function infoOf(el) { return el && el.nodeType === 1 ? st.map.get(el) : null; }
  /** The element a click means: the nearest rendered template element; inside a <dc-import>, its host. */
  function pick(t) {
    for (var n = t; n && n !== document.documentElement; n = n.parentElement) {
      var info = infoOf(n);
      if (!info) continue;
      if (!info.inner) return n;
      for (var u = n.parentElement; u; u = u.parentElement) { var i2 = infoOf(u); if (i2 && !i2.inner && i2.tpl === info.tpl) return u; }
    }
    return null;
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height && el.children.length) {
      var rs = Array.prototype.map.call(el.children, rectOf).filter(function (x) { return x.w || x.h; });
      if (!rs.length) return { x: r.left, y: r.top, w: 0, h: 0 };
      var x = Math.min.apply(null, rs.map(function (b) { return b.x; })), y = Math.min.apply(null, rs.map(function (b) { return b.y; }));
      return { x: x, y: y, w: Math.max.apply(null, rs.map(function (b) { return b.x + b.w; })) - x, h: Math.max.apply(null, rs.map(function (b) { return b.y + b.h; })) - y };
    }
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  function elementsOf(tid) {
    var parsed = get(st.file), node = parsed && parsed.nodes[tid];
    if (!node) return [];
    return Array.prototype.filter.call(document.body.querySelectorAll("*"), function (el) {
      var i = st.map.get(el); return i && !i.inner && i.tpl === node;
    });
  }
  var COMPUTED = ["color", "backgroundColor", "fontSize", "fontWeight", "fontFamily", "lineHeight", "textAlign", "paddingTop", "paddingRight",
    "paddingBottom", "paddingLeft", "rowGap", "columnGap", "borderTopLeftRadius", "width", "height", "display", "flexDirection",
    "justifyContent", "alignItems", "flexWrap", "gridTemplateColumns", "gridTemplateRows"];
  function sendSel() {
    var items = st.sel.map(function (tid) {
      var els = elementsOf(tid), el = els[0], cs = el ? getComputedStyle(el) : null, comp = {};
      if (cs) COMPUTED.forEach(function (k) { comp[k] = cs[k]; });
      return { tid: tid, rects: els.slice(0, 50).map(rectOf), computed: comp, count: els.length,
        text: el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) : "" };
    });
    post({ t: "sel", items: items, editing: st.editing ? (infoOf(st.editing) || {}).tpl.__dcTid : null });
  }
  function hover(el) {
    if (el === st.hover) return;
    st.hover = el;
    post({ t: "hover", rect: el ? rectOf(el) : null });
  }

  // ------------------------------------------------------------------ text, typed in place
  function editableFrom(t) {
    var el = pick(t);
    if (!el) return null;
    var info = infoOf(el);
    if (info.inner) return null;
    // A run inside a paragraph is edited with its paragraph.
    for (var n = el, best = null; n && n !== document.body; n = n.parentElement) {
      var i = infoOf(n);
      if (!i || i.inner) break;
      if (DC.textEditable(i.tpl)) best = n; else if (best) break;
    }
    return best;
  }
  function startEdit(el, at) {
    if (!el) return;
    commit();
    st.editing = el; st.editStart = el.innerHTML;
    st.inst.paused = true;
    el.setAttribute("contenteditable", "true");
    el.spellcheck = false;
    el.focus();
    var s = window.getSelection();
    if (at && document.caretRangeFromPoint) { var c = document.caretRangeFromPoint(at.x, at.y); if (c && el.contains(c.startContainer)) { s.removeAllRanges(); s.addRange(c); } }
    else { var r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); }
    var tid = infoOf(el).tpl.__dcTid;
    st.sel = [tid];
    post({ t: "editing", on: true, tid: tid });
    sendSel();
  }
  function commit() {
    var el = st.editing;
    if (!el) return;
    st.editing = null;
    var html = el.innerHTML, tid = infoOf(el).tpl.__dcTid;
    el.removeAttribute("contenteditable");
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    post({ t: "editing", on: false, tid: tid });
    if (html !== st.editStart) post({ t: "text", tid: tid, html: html });
    st.inst.resume();
  }

  // ------------------------------------------------------------------ input
  function isField(t) { return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable); }
  var pan = null;
  function startPan(e) {
    e.preventDefault();
    pan = { id: e.pointerId };
    try { document.documentElement.setPointerCapture(e.pointerId); } catch (x) {}
    post({ t: "pan", ph: "start", sx: e.screenX, sy: e.screenY });
  }
  window.addEventListener("pointerdown", function (e) {
    if (standalone) return;
    post({ t: "down", button: e.button });
    if (st.wheel === "forward" && (e.button === 1 || (e.button === 0 && st.space))) { startPan(e); return; }
    if (st.mode !== "edit" || e.button !== 0) return;
    if (st.editing && st.editing.contains(e.target)) return;
    commit();
    e.preventDefault();
    var el = pick(e.target);
    if (!el) { st.sel = []; post({ t: "sel", items: [], board: true }); return; }
    var tid = infoOf(el).tpl.__dcTid;
    if (e.shiftKey) st.sel = st.sel.indexOf(tid) >= 0 ? st.sel.filter(function (x) { return x !== tid; }) : st.sel.concat([tid]);
    else st.sel = [tid];
    sendSel();
  }, true);
  window.addEventListener("pointermove", function (e) {
    if (pan) { post({ t: "pan", ph: "move", sx: e.screenX, sy: e.screenY }); return; }
    if (st.mode === "edit" && !st.editing) hover(pick(e.target));
  }, true);
  function endPan(e) {
    if (!pan) return;
    try { document.documentElement.releasePointerCapture(pan.id); } catch (x) {}
    pan = null;
    post({ t: "pan", ph: "end", sx: e.screenX, sy: e.screenY });
  }
  window.addEventListener("pointerup", endPan, true);
  window.addEventListener("pointercancel", endPan, true);
  window.addEventListener("mouseout", function (e) { if (!e.relatedTarget && st.mode === "edit") hover(null); });
  window.addEventListener("auxclick", function (e) { if (e.button === 1) e.preventDefault(); }, true);
  window.addEventListener("click", function (e) {
    if (st.mode === "edit") { if (!(st.editing && st.editing.contains(e.target))) { e.preventDefault(); e.stopPropagation(); } }
  }, true);
  window.addEventListener("submit", function (e) { e.preventDefault(); }, true);
  window.addEventListener("dblclick", function (e) {
    if (st.mode !== "edit") return;
    e.preventDefault(); e.stopPropagation();
    var el = editableFrom(e.target);
    if (el) startEdit(el, { x: e.clientX, y: e.clientY });
    else post({ t: "dbl", tid: (function () { var p = pick(e.target), i = infoOf(p); return i ? i.tpl.__dcTid : null; })() });
  }, true);
  window.addEventListener("contextmenu", function (e) { if (st.mode === "edit") e.preventDefault(); }, true);
  // Links between artboards move Play; #id scrolls; the web opens a tab.
  window.addEventListener("click", function (e) {
    if (st.mode === "edit" || e.defaultPrevented) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    e.preventDefault();
    if (href.charAt(0) === "#") {
      var t = href.length > 1 && document.getElementById(decodeURIComponent(href.slice(1)));
      if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); else window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (/^(https?:|mailto:|tel:)/i.test(href)) { try { window.open(href, "_blank", "noopener"); } catch (x) {} return; }
    var target = resolvePath(href, st.file);
    if (!target || !/\.dc\.html$/.test(target)) return;
    if (standalone) { if (st.sources[target] != null) { st.file = target; st.props = st.propsAll[target] || {}; mount(); window.scrollTo(0, 0); } return; }
    post({ t: "link", file: target });
  });
  window.addEventListener("keydown", function (e) {
    if (standalone) return;
    if (st.editing) {
      if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); commit(); sendSel(); }
      else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); document.execCommand("insertLineBreak"); }
      return;
    }
    if (e.key === " " && !isField(e.target)) st.space = true;
    if (isField(e.target) && e.key !== "Escape") return;
    if (st.mode === "edit") {
      var mod = e.ctrlKey || e.metaKey;
      if (e.key === " " || e.key === "Delete" || e.key === "Backspace" || e.key === "Enter" || e.key === "Escape" || /^Arrow/.test(e.key) ||
          (mod && /^[zysdaZYSDA0=+-]$/.test(e.key))) e.preventDefault();
    }
    post({ t: "key", key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
  }, true);
  window.addEventListener("keyup", function (e) {
    if (e.key === " ") { st.space = false; post({ t: "key", key: " ", up: true }); }
  }, true);
  window.addEventListener("paste", function (e) {
    if (!st.editing) return;
    e.preventDefault();
    var text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    document.execCommand("insertText", false, text);
  }, true);
  window.addEventListener("focusout", function (e) {
    if (st.editing && e.target === st.editing) setTimeout(function () { if (st.editing && document.activeElement !== st.editing) { commit(); sendSel(); } }, 0);
  }, true);
  window.addEventListener("wheel", function (e) {
    if (st.wheel !== "forward") return;
    e.preventDefault();
    post({ t: "wheel", dx: e.deltaX, dy: e.deltaY, dm: e.deltaMode, ctrl: e.ctrlKey || e.metaKey, x: e.clientX, y: e.clientY });
  }, { passive: false, capture: true });
  // An image dropped on an <img>: replace it (the canvas stores it under uploads/).
  window.addEventListener("dragover", function (e) { if (st.mode === "edit" && e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0) e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (st.mode !== "edit" || !f) return;
    e.preventDefault();
    var el = pick(e.target);
    if (!el || el.localName !== "img") return;
    var fr = new FileReader();
    fr.onload = function () { post({ t: "drop", tid: infoOf(el).tpl.__dcTid, url: fr.result, name: f.name, type: f.type, size: f.size }); };
    fr.readAsDataURL(f);
  });
  window.addEventListener("error", function (e) { fail(e.error || e.message); });
  window.addEventListener("unhandledrejection", function (e) { fail(e.reason); });
  if (window.ResizeObserver) new ResizeObserver(function () { rendered(); }).observe(document.documentElement);

  // ------------------------------------------------------------------ pictures (export)
  var fontCache = {};
  function fetchData(u) {
    if (fontCache[u]) return fontCache[u];
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    return (fontCache[u] = fetch(u, { mode: "cors", signal: ctl && ctl.signal }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.blob();
    }).then(function (b) {
      clearTimeout(t);
      return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(b); });
    }).catch(function () { clearTimeout(t); return null; }));
  }
  /** Every style of the document as text, Google Fonts' faces inlined (a picture can't fetch them). */
  function sheetsCss() {
    var parts = Array.prototype.map.call(document.styleSheets, function (ss) {
      try { return Promise.resolve(Array.prototype.map.call(ss.cssRules, function (r) { return r.cssText; }).join("\n")); }
      catch (e) {
        var href = ss.href || "";
        if (!/^https:\/\/fonts\.googleapis\.com\//.test(href)) return Promise.resolve("");
        return fetchData(href).then(function (d) { return d ? atob(d.slice(d.indexOf(",") + 1)) : ""; });
      }
    });
    return Promise.all(parts).then(function (texts) {
      var css = texts.join("\n"), urls = [], re = /url\(\s*["']?(https:\/\/fonts\.gstatic\.com\/[^"')]+)["']?\s*\)/g, m;
      while ((m = re.exec(css))) if (urls.indexOf(m[1]) < 0) urls.push(m[1]);
      return Promise.all(urls.slice(0, 60).map(fetchData)).then(function (ds) {
        urls.slice(0, 60).forEach(function (u, i) { if (ds[i]) css = css.split(u).join(ds[i]); });
        return css;
      });
    });
  }
  function bgOf() {
    var b = document.body && getComputedStyle(document.body).backgroundColor, h = getComputedStyle(document.documentElement).backgroundColor;
    var clear = function (c) { return !c || c === "transparent" || /rgba\(.*,\s*0\)$/.test(c); };
    return !clear(b) ? b : !clear(h) ? h : "#ffffff";
  }
  /** Where a flowing document breaks onto pages: between lines, never through a picture; a heading stays
   *  with what follows it. Returns the cut positions in px. */
  function cutsFor(total, pageH, pad, lines) {
    var bad = lines.map(function (l) { return [l.y, l.y + l.h]; });
    document.body.querySelectorAll("img,svg,canvas,video,picture").forEach(function (el) {
      var r = el.getBoundingClientRect(), top = r.top - document.documentElement.getBoundingClientRect().top;
      if (r.height > 0 && r.height < 950) bad.push([top, top + r.height]);
    });
    var heads = Array.prototype.map.call(document.body.querySelectorAll("h1,h2,h3,h4,h5,h6,caption,thead"), function (el) {
      var r = el.getBoundingClientRect(), top = r.top - document.documentElement.getBoundingClientRect().top;
      return [top, top + r.height, parseFloat(getComputedStyle(el).fontSize) || 16];
    });
    var cuts = [], s = 0, avail = pageH - pad;
    while (s + avail < total && cuts.length < 100) {
      var target = s + avail, cut = target, moved = true;
      while (moved) {
        moved = false;
        for (var i = 0; i < bad.length; i++) if (bad[i][0] < cut - 0.5 && bad[i][1] > cut + 0.5 && bad[i][0] > s) { cut = bad[i][0]; moved = true; }
      }
      heads.forEach(function (hd) {
        if (hd[0] > s && hd[1] <= cut && cut - hd[1] < hd[2] * 2.2 && hd[0] - s > avail * 0.75) cut = Math.min(cut, hd[0]);
      });
      if (cut <= s + avail * 0.25) cut = target;
      cut = Math.floor(cut);
      cuts.push(cut); s = cut; avail = pageH - 2 * pad;
    }
    return cuts;
  }
  /** The frame at the size the canvas gave it (a frame just made may not have its size yet). */
  function sized(w, h) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function check() {
        if (!w || (Math.abs(window.innerWidth - w) < 1.5 && Math.abs(window.innerHeight - h) < 1.5) || Date.now() - t0 > 3000) return resolve();
        setTimeout(check, 30);
      })();
    });
  }
  function raster(m) {
    return sized(m.w, m.h).then(settle).then(sheetsCss).then(function (cssText) {
      var de = document.documentElement, W = Math.max(1, Math.round(m.w || window.innerWidth));
      var H = Math.max(1, Math.round(m.full ? Math.max(de.scrollHeight, document.body.scrollHeight, m.h || window.innerHeight) : m.h || window.innerHeight));
      var scale = Math.min(m.scale || 1, 30000 / H, 16000 / W);
      var lines = kit && kit.textLines ? kit.textLines(de) : [];
      var cuts = m.paper ? cutsFor(H, m.paper.pageH, m.paper.pad, lines) : [];
      var clone = de.cloneNode(true);
      var src = document.querySelectorAll("input,textarea,select"), dst = clone.querySelectorAll("input,textarea,select");
      Array.prototype.forEach.call(src, function (el, i) {
        var c = dst[i]; if (!c) return;
        if (el.type === "checkbox" || el.type === "radio") { if (el.checked) c.setAttribute("checked", ""); else c.removeAttribute("checked"); }
        else if (el.tagName === "TEXTAREA") c.textContent = el.value;
        else if (el.tagName === "SELECT") Array.prototype.forEach.call(c.options, function (o, k) { if (k === el.selectedIndex) o.setAttribute("selected", ""); else o.removeAttribute("selected"); });
        else c.setAttribute("value", el.value);
      });
      clone.querySelectorAll("script,link,style,meta,title").forEach(function (n) { n.remove(); });
      clone.querySelectorAll("[contenteditable]").forEach(function (n) { n.removeAttribute("contenteditable"); });
      var head = clone.querySelector("head");
      if (!head) { head = document.createElement("head"); clone.insertBefore(head, clone.firstChild); }
      var style = document.createElement("style");
      style.textContent = cssText + "\nhtml{overflow:visible!important;scrollbar-width:none}";
      head.appendChild(style);
      var theme = de.getAttribute("data-theme");
      var xhtml = new XMLSerializer().serializeToString(clone);
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"' + (theme ? ' data-theme="' + theme.replace(/"/g, "") + '"' : "") +
        '><foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' + xhtml + "</foreignObject></svg>";
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var c = document.createElement("canvas");
          c.width = Math.round(W * scale); c.height = Math.round(H * scale);
          var g = c.getContext("2d");
          g.fillStyle = bgOf(); g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (blob) {
            if (!blob) return reject(new Error("picture failed"));
            resolve({ blob: blob, w: W, h: H, scale: scale, lines: lines, cuts: cuts, bg: bgOf() });
          }, m.type || "image/png", 0.92);
        };
        img.onerror = function () { reject(new Error("picture failed")); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      });
    });
  }

  // ------------------------------------------------------------------ messages from the canvas
  function setMode(mode, wheel) {
    if (mode !== "edit") { commit(); st.sel = []; hover(null); }
    st.mode = mode; if (wheel) st.wheel = wheel;
    document.documentElement.classList.toggle("dc-edit", mode === "edit");
    document.documentElement.classList.toggle("dc-canvas", st.wheel === "forward");
  }
  function setDs(cssText) {
    var s = document.getElementById("dc-ds");
    if (!cssText) { if (s) s.remove(); return; }
    if (!s) { s = document.createElement("style"); s.id = "dc-ds"; document.head.insertBefore(s, document.head.firstChild); }
    s.textContent = cssText;
  }
  function setTheme(t) { if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); }
  window.addEventListener("message", function (e) {
    if (e.source !== window.parent || !e.data || e.data.__dc !== 1) return;
    var m = e.data;
    switch (m.t) {
      case "init":
        st.id = m.id; st.file = m.file; st.sources = m.sources || {}; st.parsed = {}; st.urls = m.urls || {}; st.css = m.css || {};
        st.props = m.props || {};
        setMode(m.mode || "edit", m.wheel || "forward");
        setDs(m.ds); setTheme(m.theme);
        mount();
        break;
      case "src":
        var changed = Object.keys(m.sources || {});
        changed.forEach(function (p) { if (m.sources[p] == null) delete st.sources[p]; else st.sources[p] = m.sources[p]; delete st.parsed[p]; });
        if (!st.inst) { mount(); break; }
        if (st.inst.files().some(function (f) { return changed.indexOf(f) >= 0; })) {
          st.errors = [];
          if (changed.indexOf(st.file) >= 0) headLinks(get(st.file) || { head: { links: [] } });
          st.inst.refresh(changed);
          if (!st.errors.length) post({ t: "error", errors: [] });
        }
        break;
      case "urls": Object.assign(st.urls, m.urls || {}); break;
      case "props": st.props = m.props || {}; if (st.inst) st.inst.setProps(st.props); break;
      case "mode": setMode(m.mode, m.wheel); if (m.restart) mount(); break;
      case "restart": mount(); break;
      case "select":
        st.sel = (m.tids || []).filter(function (x) { return typeof x === "number"; });
        if (m.scroll && st.sel.length) { var el = elementsOf(st.sel[0])[0]; if (el) el.scrollIntoView({ block: "center" }); }
        sendSel();
        break;
      case "edit": var els = elementsOf(m.tid); if (els[0] && DC.textEditable(infoOf(els[0]).tpl)) startEdit(els[0]); break;
      case "commit": commit(); break;
      case "space": st.space = !!m.on; break;
      case "ds": setDs(m.css); break;
      case "theme": setTheme(m.theme); break;
      case "raster":
        raster(m).then(function (r) { r.t = "raster"; r.req = m.req; post(r); }, function (err) { post({ t: "raster", req: m.req, error: String(err && err.message || err) }); });
        break;
    }
  });

  // ------------------------------------------------------------------ standalone export
  if (standalone) {
    var data = JSON.parse(standalone.textContent);
    st.sources = data.sources || {}; st.urls = data.urls || {}; st.css = data.css || {}; st.propsAll = data.props || {};
    st.file = data.file; st.props = st.propsAll[st.file] || {};
    setMode("play", "native"); setDs(data.ds); setTheme(data.theme);
    mount();
  } else {
    post({ t: "hello" });
  }
})();
