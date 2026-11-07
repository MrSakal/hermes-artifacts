/* Shared helpers of the hermes-artifacts type runtimes. Exposes window.kit. */
(function () {
  var el = document.getElementById("hermes-artifact-content");
  var content = { files: {}, title: "", type: "", version: 0, thumb: false };
  try { if (el) content = JSON.parse(el.textContent); } catch (e) { console.error("artifact content unreadable", e); }
  if (content.thumb) document.documentElement.setAttribute("data-thumb", "");

  var ICONS = {
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    download: "M12 4v11M7 10l5 5 5-5M5 20h14",
    data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
    close: "M6 6l12 12M18 6L6 18",
    play: "M7 4l13 8-13 8z",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    prev: "M15 18l-6-6 6-6",
    next: "M9 18l6-6-6-6",
    notes: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    panel: "M4 5h16v14H4zM14 5v14",
    braces: "M8 4c-2 0-2 1.5-2 3s0 3-2 5c2 2 2 3.5 2 5s0 3 2 3M16 4c2 0 2 1.5 2 3s0 3 2 5c-2 2-2 3.5-2 5s0 3-2 3",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
    comment: "M4 5h16v11H9l-5 4z",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4",
    redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h4",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
    copy: "M8 8h12v12H8zM16 8V4H4v12h4",
    front: "M9 9h11v11H9zM4 15V4h11",
    back: "M4 4h11v11H4zM20 9v11H9",
    alignL: "M4 6h16M4 10h10M4 14h16M4 18h10",
    alignC: "M4 6h16M7 10h10M4 14h16M7 18h10",
    alignR: "M4 6h16M10 10h10M4 14h16M10 18h10",
    bold: "M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z",
    italic: "M10 5h8M6 19h8M14 5l-4 14",
    underline: "M7 4v7a5 5 0 0 0 10 0V4M5 20h14",
    text: "M5 7V5h14v2M12 5v14M9 19h6",
    image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
    shape: "M4 4h9v9H4zM14 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0",
    presenter: "M3 4h18v12H3zM8 20h8M12 16v4",
    pause: "M8 5v14M16 5v14",
    fontUp: "M3 18l5-12 5 12M5 14h6M18 6v6M15 9h6",
    fontDown: "M3 18l5-12 5 12M5 14h6M15 9h6",
    file: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5",
    history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2",
    palette: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.1-.9-1.4-.9-2.4 0-.9.8-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-4.6-4-8.5-9-8.5zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
    pencil: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
    expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
    caretDown: "M7 10l5 5 5-5",
    caretRight: "M10 7l5 5-5 5"
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true"><path d="' + (ICONS[name] || "") + '"/></svg>';
  }

  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  function button(label, iconName, onClick, title) {
    return h("button", { "class": "kit-btn", type: "button", title: title || label, onclick: onClick,
      html: (iconName ? icon(iconName) : "") + (label ? "<span></span>" : "") }, []);
  }
  function labelled(btn, label) { var s = btn.querySelector("span"); if (s) s.textContent = label; return btn; }

  var openMenu = null;
  function menu(anchor, items) {
    if (openMenu) { openMenu.remove(); openMenu = null; }
    var m = h("div", { "class": "kit-menu", role: "menu" });
    items.forEach(function (it) {
      if (it.hint) return m.appendChild(h("div", { "class": "kit-hint", text: it.hint }));
      m.appendChild(h("button", { type: "button", text: it.label, onclick: function () { close(); it.onClick(); } }));
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = r.bottom + 4 + "px";
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
    function close() { m.remove(); openMenu = null; document.removeEventListener("mousedown", out, true); }
    function out(e) { if (!m.contains(e.target)) close(); }
    setTimeout(function () { document.addEventListener("mousedown", out, true); }, 0);
    openMenu = m;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = document.querySelector(".kit-toast") || document.body.appendChild(h("div", { "class": "kit-toast" }));
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 2600);
  }

  /** Save a file: through the host (hermes.download) when available, else an <a download>. */
  function download(name, data, type) {
    if (window.hermes && window.hermes.download) {
      return window.hermes.download(name, data, type).catch(function () { fallback(); });
    }
    fallback();
    function fallback() {
      var url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type }));
      var a = h("a", { href: url, download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }
  }

  /** A data: URI or text file of the artifact as text. */
  function fileText(path) {
    var v = content.files[path];
    if (v == null) return null;
    if (typeof v === "string" && v.slice(0, 5) === "data:") {
      var b64 = v.slice(v.indexOf(",") + 1);
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return v;
  }
  function fileUrl(path) {
    var v = content.files[path];
    if (v == null) return null;
    if (typeof v === "string" && v.slice(0, 5) === "data:") return v;
    var mime = /\.svg$/i.test(path) ? "image/svg+xml" : "text/plain";
    return "data:" + mime + ";charset=utf-8," + encodeURIComponent(v);
  }
  function json(path, fallback) {
    var t = fileText(path);
    if (t == null) return fallback;
    try { return JSON.parse(t); } catch (e) { return fallback; }
  }

  // Theme from the host (Hermes Desktop sends its light/dark mode once the bridge connects).
  var COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|color\(srgb[\d\s.,%/-]+\)|hsla?\([\d\s.,%/deg]+\))$/i;
  var host = null, themeListeners = [];
  function applyTheme(v) {
    var st = document.documentElement.style, ok = function (c) { return typeof c === "string" && COLOR.test(c.trim()); };
    var set = function (name, val) { if (ok(val)) st.setProperty(name, val); };
    set("--color-bg", v.bg); set("--color-panel", v.panel); set("--color-fg", v.fg); set("--color-fg-secondary", v.fg2);
    set("--color-fg-muted", v.muted); set("--color-border-line", v.line); set("--color-border-strong", v.strong);
    set("--color-hover", v.hover);
    set("--color-bad", v.bad); set("--color-ok", v.ok); set("--color-warn", v.warn);
    if (ok(v.elevated)) st.setProperty("--color-elevated", v.elevated);
    var px = function (r) { return typeof r === "string" && /^[\d.]+px$/.test(r); };
    if (px(v.radiusSm)) st.setProperty("--kit-r-sm", v.radiusSm);
    if (px(v.radiusLg)) st.setProperty("--kit-r-lg", v.radiusLg);
    if (ok(v.accent)) {
      st.setProperty("--color-accent", v.accent);
      st.setProperty("--chart-1", v.accent);
      st.setProperty("--color-accent-soft", "color-mix(in srgb, " + v.accent + " 14%, transparent)");
    }
    if (typeof v.font === "string" && /^[\w\s"',.-]{1,400}$/.test(v.font)) { st.setProperty("--font-sans", v.font); st.setProperty("--font-display", v.font); }
    if (typeof v.mono === "string" && /^[\w\s"',.-]{1,400}$/.test(v.mono)) st.setProperty("--font-mono", v.mono);
    if (typeof v.radius === "string" && /^[\d.]+(px|rem)$/.test(v.radius)) st.setProperty("--radius", v.radius);
  }
  if (window.hermes && window.hermes.on) {
    window.hermes.on("theme", function (d) {
      if (d && (d.mode === "dark" || d.mode === "light")) document.documentElement.setAttribute("data-theme", d.mode);
      if (d && d.vars && typeof d.vars === "object") {
        host = Object.assign({ mode: d.mode }, d.vars);
        applyTheme(d.vars);
        themeListeners.forEach(function (fn) { try { fn(host); } catch (e) {} });
      }
    });
  }
  /** The host's theme (null until it arrives); fn runs when it does. */
  function hostTheme(fn) { if (fn) themeListeners.push(fn); return host; }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function slug(s) { return String(s || "artifact").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "artifact"; }

  /** Ready handshake for thumbnails: fonts, images, two frames. */
  function ready() {
    var imgs = Array.prototype.slice.call(document.images).map(function (i) { return i.decode ? i.decode().catch(function () {}) : 0; });
    return Promise.all([document.fonts ? document.fonts.ready : 0].concat(imgs)).then(function () {
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        document.documentElement.setAttribute("data-thumb-ready", "");
      }); });
    });
  }

  /** Offer exports in the host's toolbar. Resolves true when the host took them; false when the page
   *  should show its own Export button (preview, browser viewer, an older host). */
  function exports(list) {
    var handlers = {};
    list.forEach(function (x) { handlers[x.id] = x.run; });
    if (!window.hermes || !window.hermes.chrome) return Promise.resolve(false);
    window.hermes.on("export", function (d) { var f = d && handlers[d.id]; if (f) f(); });
    return Promise.race([
      window.hermes.chrome({ exports: list.map(function (x) { return { id: x.id, label: x.label }; }) })
        .then(function (r) { return !!(r && r.ok); }, function () { return false; }),
      new Promise(function (r) { setTimeout(function () { r(false); }, 4000); })
    ]);
  }

  /** Tell the host where the user is in the page (it goes along with their next chat message).
   *  Debounced, and only when it changed. Thumbnails never report. */
  var viewTimer = null, viewLast = "";
  function view(get) {
    if (content.thumb || !window.hermes || !window.hermes.view) return;
    clearTimeout(viewTimer);
    viewTimer = setTimeout(function () {
      var ctx;
      try { ctx = get(); } catch (e) { return; }
      var s = JSON.stringify(ctx);
      if (s === viewLast) return;
      viewLast = s;
      window.hermes.view(ctx).catch(function () {});
    }, 600);
  }
  function inView(selector) {
    var best = null;
    document.querySelectorAll(selector).forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom > 60 && r.top < innerHeight * 0.6 && (!best || r.top > best.r.top)) best = { el: el, r: r };
    });
    return best ? best.el : null;
  }

  /** The lines of text inside root as drawn: [{text, x, y, w, h, size}] in px from root's top-left. */
  function textLines(root) {
    var o = root.getBoundingClientRect(), lines = [], cur = null, rg = document.createRange();
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      var p = n.parentElement;
      if (!p || !n.textContent.trim() || p.closest("aside,script,style,[data-build-hidden]")) return NodeFilter.FILTER_REJECT;
      var cs = getComputedStyle(p);
      return cs.visibility === "hidden" || cs.display === "none" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    } });
    var n;
    while ((n = tw.nextNode())) {
      var fs = parseFloat(getComputedStyle(n.parentElement).fontSize) || 16, re = /\S+/g, m;
      while ((m = re.exec(n.textContent))) {
        rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
        var rs = rg.getClientRects();
        if (!rs.length || rs[0].width <= 0) continue;
        var r = rs[0], x = r.left - o.left, y = r.top - o.top, gap = cur ? x - (cur.x + cur.w) : 0;
        if (cur && Math.abs(y - cur.y) < r.height * 0.5 && gap > -2 && gap < r.height * 2) {
          cur.text += (gap > r.height * 0.12 ? " " : "") + m[0];
          cur.w = x + r.width - cur.x; cur.h = Math.max(cur.h, r.height); cur.size = Math.max(cur.size, fs);
        } else lines.push(cur = { text: m[0], x: x, y: y, w: r.width, h: r.height, size: fs });
      }
    }
    return lines;
  }

  /** Invisible text over the pictures of a pdf-lib document, so the PDF can be searched and copied.
   *  Any Unicode: characters outside ASCII get codes of their own (as uniXXXX glyph names) in as many
   *  fonts as needed. add(page, textLines(...), pt per px) per page, then finish() before saving. */
  function pdfText(P, doc) {
    var ctx = doc.context, fonts = [];
    function font() { var f = { ref: ctx.nextRef(), map: {}, list: [] }; fonts.push(f); return f; }
    font();
    function place(ch) {
      var k = ch.codePointAt(0);
      if (k >= 32 && k < 127) return [-1, k];
      for (var i = 0; i < fonts.length; i++) if (fonts[i].map[ch] != null) return [i, fonts[i].map[ch]];
      var f = fonts[fonts.length - 1];
      if (f.list.length >= 128) f = font();
      f.map[ch] = 128 + f.list.length; f.list.push(ch);
      return [fonts.length - 1, f.map[ch]];
    }
    function glyph(ch) { var k = ch.codePointAt(0), x = k.toString(16).toUpperCase(); return k > 0xFFFF ? "u" + x : "uni" + ("000" + x).slice(-4); }
    return {
      add: function (page, lines, k) {
        var ph = page.getHeight(), names = {};
        var nameOf = function (i) { return names[i] || (names[i] = page.node.newFontDictionary("HT" + i, fonts[i].ref)); };
        var ops = [P.pushGraphicsState(), P.beginText(), P.setTextRenderingMode(P.TextRenderingMode.Invisible)];
        lines.forEach(function (ln) {
          var chars = Array.from(ln.text).filter(function (c) { return c.codePointAt(0) >= 32; });
          if (!chars.length) return;
          var size = ln.size * k, tz = Math.max(5, Math.min(1000, 100 * ln.w * k / (chars.length * 0.5 * size)));
          ops.push(P.setCharacterSqueeze(tz), P.setTextMatrix(1, 0, 0, 1, ln.x * k, ph - (ln.y + ln.h * 0.78) * k));
          var cf = null, hex = "";
          var flush = function () { if (hex) ops.push(P.setFontAndSize(nameOf(cf), size), P.showText(P.PDFHexString.of(hex))); hex = ""; };
          chars.forEach(function (ch) {
            var pl = place(ch), fi = pl[0] < 0 ? (cf == null ? 0 : cf) : pl[0];
            if (fi !== cf) { flush(); cf = fi; }
            hex += ("0" + pl[1].toString(16)).slice(-2);
          });
          flush();
        });
        ops.push(P.endText(), P.popGraphicsState());
        page.pushOperators.apply(page, ops);
      },
      finish: function () {
        fonts.forEach(function (f) {
          var widths = []; for (var i = 32; i <= 255; i++) widths.push(500);
          ctx.assign(f.ref, ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", FirstChar: 32, LastChar: 255, Widths: widths,
            Encoding: f.list.length ? { Type: "Encoding", BaseEncoding: "WinAnsiEncoding", Differences: [128].concat(f.list.map(glyph)) } : "WinAnsiEncoding" }));
        });
      }
    };
  }

  window.kit = { textLines: textLines, pdfText: pdfText, view: view, inView: inView, hostTheme: hostTheme, exports: exports, content: content, h: h, icon: icon, button: button, labelled: labelled, menu: menu, toast: toast,
    download: download, fileText: fileText, fileUrl: fileUrl, json: json, esc: esc, slug: slug, ready: ready };
})();
