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
    sparkle: "M12 6v15M12 6.5c-1.8-2.2-4.6-2.9-8-2.4 1.6 1.6 4.4 2.6 8 2.6M12 6.5c1.8-2.2 4.6-2.9 8-2.4-1.6 1.6-4.4 2.6-8 2.6M12 4.6a1.3 1.3 0 1 0 0-.1M9 10.5c4.5 1.2 6 2.6 6 3.6s-6 1.6-6 3.4c0 1 1.5 1.6 3 2M15 10.5c-4.5 1.2-6 2.6-6 3.6s6 1.6 6 3.4c0 1-1.5 1.6-3 2", // Hermes' caduceus: the buttons that ask Hermes
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
    pause: "M8 5v14M16 5v14",
    fontUp: "M3 18l5-12 5 12M5 14h6M18 6v6M15 9h6",
    fontDown: "M3 18l5-12 5 12M5 14h6M15 9h6",
    file: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5",
    history: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2",
    palette: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.1-.9-1.4-.9-2.4 0-.9.8-1.5 1.7-1.5H17a4 4 0 0 0 4-4c0-4.6-4-8.5-9-8.5zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
    pencil: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
    expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
    caretDown: "M7 10l5 5 5-5",
    caretRight: "M10 7l5 5-5 5",
    pages: "M8 4h9a2 2 0 0 1 2 2v10M5 8h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z",
    cursor: "M6 3l13 9-6 1.5L10.5 20z",
    hand: "M8 12V6a1.5 1.5 0 0 1 3 0v5V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.2-2.3L4 14.5a1.5 1.5 0 0 1 2.5-1.6z",
    frame: "M8 3v18M16 3v18M3 8h18M3 16h18",
    sticky: "M5 5h14v9l-5 5H5zM19 14h-5v5",
    oval: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z",
    arrowUR: "M6 18L18 6M9 6h9v9",
    lineD: "M5 19L19 5",
    table: "M4 5h16v14H4zM4 10h16M4 14.5h16M10 5v14",
    sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
    slide: "M5 6h14v12H5z",
    strip: "M4 5h16v9H4zM4 18h4M10 18h4M16 18h4",
    chevDown: "M6 9l6 6 6-6",
    justify: "M4 6h16M4 12h16M4 18h16",
    volume: "M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
    volumeOff: "M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6",
    repeat: "M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4",
    restart: "M6 5v14M19 5l-10 7 10 7z"
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

  var openMenu = null, menuAnchor = null;
  /** A dropdown under anchor. Clicking anchor again closes it (it never closes and reopens);
   *  a scroll or a resize closes it too, so it never drifts away from its button. */
  function menu(anchor, items) {
    if (openMenu) {
      var same = menuAnchor === anchor;
      openMenu.close();
      if (same) return;
    }
    var m = h("div", { "class": "kit-menu", role: "menu" });
    items.forEach(function (it) {
      if (it.hint) return m.appendChild(h("div", { "class": "kit-hint", text: it.hint }));
      m.appendChild(h("button", { type: "button", text: it.label, onclick: function () { close(); it.onClick(); } }));
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    // below its opener; above it when there is no room below (a toolbar at the foot of the page)
    var mh = m.offsetHeight, below = r.bottom + 4 + mh <= innerHeight - 8 || r.top - 4 - mh < 8;
    m.style.top = (below ? r.bottom + 4 : r.top - 4 - mh) + "px";
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + "px";
    function close() {
      m.remove(); openMenu = null; menuAnchor = null;
      document.removeEventListener("mousedown", out, true);
      window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", close);
    }
    function onScroll(e) { if (!m.contains(e.target)) close(); } // the page scrolling closes it; the menu's own list scrolling does not
    function out(e) { if (!m.contains(e.target) && !(anchor.contains && anchor.contains(e.target))) close(); }
    setTimeout(function () { document.addEventListener("mousedown", out, true); window.addEventListener("scroll", onScroll, true); window.addEventListener("resize", close); }, 0);
    m.close = close;
    openMenu = m; menuAnchor = anchor;
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = document.querySelector(".kit-toast") || document.body.appendChild(h("div", { "class": "kit-toast" }));
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, ms > 0 ? ms : 2600);
  }

  // No host (the bridge's "offline": no port within its timeout, or the page opened on its own): the page
  // shows what it has and says so once, in the runtime's words (degraded(T.offline) at boot). Not on cards.
  var offline = { text: "", due: false, shown: false };
  function offlineShow() {
    if (offline.shown || !offline.due || !offline.text || content.thumb || !document.body) return;
    offline.shown = true;
    toast(offline.text, 8000);
  }
  function whenLoaded(fn) {
    if (document.readyState === "complete") fn();
    else window.addEventListener("load", function () { fn(); });
  }
  function degraded(text) { offline.text = String(text || ""); whenLoaded(offlineShow); }
  if (window.hermes && window.hermes.on) {
    window.hermes.on("offline", function () { offline.due = true; whenLoaded(offlineShow); });
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
  // A card preview has no bridge: the host wrote its theme into a <meta name="hermes-theme"> (JSON).
  var pre = null;
  try {
    var tm = document.querySelector('meta[name="hermes-theme"]');
    pre = tm ? JSON.parse(tm.getAttribute("content") || "null") : null;
  } catch (e) { pre = null; }
  if (pre && typeof pre === "object" && pre.vars && typeof pre.vars === "object") {
    if (pre.mode === "dark" || pre.mode === "light") document.documentElement.setAttribute("data-theme", pre.mode);
    host = Object.assign({ mode: pre.mode }, pre.vars);
    applyTheme(pre.vars);
  }
  /** The host's theme (null until it arrives); fn runs when it does. */
  function hostTheme(fn) { if (fn) themeListeners.push(fn); return host; }

  // Hermes at work here (the live types' "Hermes is working" marks). The server says that Hermes changed the
  // artifact lately (hermes_active, for hermes_left more seconds) and how long ago (hermes_ago); Hermes Desktop
  // says whether a run is in flight and since when ("run": {on, age ms}). With the host's word Hermes is at work
  // while a run that changed this artifact is in flight, and only then (its end, an error or a stop ends it; a
  // fresh open with nothing running shows nothing); a change no run here explains (Hermes on another platform)
  // counts for a moment. Without the host's word (a browser), the server's window alone.
  var FRESH = 15000;
  var work = { host: null, start: 0, end: 0, at: null, until: 0, fns: [] };
  function workSeen(active, left, ago) {
    var now = Date.now();
    if (!active) { work.at = null; work.until = 0; return; }
    work.at = now - (typeof ago === "number" && ago >= 0 ? ago * 1000 : 0); // an older server: as if just now
    work.until = now + (typeof left === "number" && left > 0 ? left * 1000 : 300000);
  }
  function workOn() {
    var now = Date.now();
    if (work.at === null || now >= work.until) return false;
    if (work.host === null) return true;
    if (work.host) return work.at >= work.start - 2000;
    return work.at > work.end + 1000 && now - work.at < FRESH;
  }
  /** Seconds until workOn() may turn false on its own (no read or host word needed). */
  function workLeft() {
    if (work.at === null) return 0;
    var ms = work.until - Date.now();
    if (work.host === false) ms = Math.min(ms, FRESH - (Date.now() - work.at));
    return Math.max(0, ms) / 1000;
  }
  if (window.hermes && window.hermes.on) {
    window.hermes.on("run", function (d) {
      var on = !!(d && d.on), now = Date.now();
      if (on && work.host !== true) work.start = now - (d && typeof d.age === "number" && d.age >= 0 ? d.age : 1e12);
      if (!on && work.host !== false) work.end = now;
      work.host = on;
      work.fns.slice().forEach(function (fn) { try { fn(); } catch (e) {} });
    });
  }
  var hermesWork = { seen: workSeen, on: workOn, left: workLeft, change: function (fn) { work.fns.push(fn); } };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function slug(s) { return String(s || "artifact").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 80) || "artifact"; }

  /** The first real render is on screen. For thumbnails: fonts, images, two frames, then data-thumb-ready.
   *  For the host (a runtime that set window.__hermesDefer = true): hermes.ready(), once, after the fonts
   *  and pictures or 1.5 s, whichever comes first (the bridge adds its two frames). */
  var hostReadyAsked = false;
  function ready() {
    var imgs = Array.prototype.slice.call(document.images).map(function (i) { return i.decode ? i.decode().catch(function () {}) : 0; });
    var settled = Promise.all([document.fonts ? document.fonts.ready : 0].concat(imgs));
    if (!hostReadyAsked && window.hermes && typeof window.hermes.ready === "function") {
      hostReadyAsked = true;
      Promise.race([settled.catch(function () {}), new Promise(function (r) { setTimeout(r, 1500); })])
        .then(function () { try { window.hermes.ready(); } catch (e) {} });
    }
    return settled.then(function () {
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

  window.kit = { textLines: textLines, pdfText: pdfText, view: view, inView: inView, hostTheme: hostTheme, hermesWork: hermesWork, exports: exports, content: content, h: h, icon: icon, button: button, labelled: labelled, menu: menu, toast: toast,
    download: download, fileText: fileText, fileUrl: fileUrl, json: json, esc: esc, slug: slug, ready: ready, degraded: degraded };
})();
