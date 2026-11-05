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
    file: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5"
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
  if (window.hermes && window.hermes.on) {
    window.hermes.on("theme", function (d) {
      if (d && (d.mode === "dark" || d.mode === "light")) document.documentElement.setAttribute("data-theme", d.mode);
    });
  }

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

  window.kit = { exports: exports, content: content, h: h, icon: icon, button: button, labelled: labelled, menu: menu, toast: toast,
    download: download, fileText: fileText, fileUrl: fileUrl, json: json, esc: esc, slug: slug, ready: ready };
})();
