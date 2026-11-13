/* Injected into every artifact page. Talks only to the parent shell over a MessagePort. */
(function () {
  if (window.hermes) return;
  // Protocol 3 (the hello's v): besides ops and events, the page sends the host "ready" (once per load),
  // "diag" (the page's errors) and, when the host's port message says v >= 3, "alive" every 2 s.
  // Pages with an older bridge (hello v 2 or none) send none of them.
  //   ready  {threw, blank, t}: threw = an uncaught error or rejection came before it; blank = the page showed
  //          nothing a user could see when it was sent (isBlank()); t = ms since the page started.
  //   diag   {entries: [{k, m, at?, n, stack?, tag?, url?}], dropped}: n and dropped count since the last post.
  //   alive  null.
  var PROTOCOL = 3;
  // Where this script sits in the document: the server put it, and its lines, right after <head>, so a
  // line the browser reports for the page's own inline code is that many lines further down.
  var self = { head: -1, k: 0, url: "" };
  try {
    var txt = document.currentScript && document.currentScript.text;
    var probe = new Error("@hermes-bridge-probe@"); // keep on one line with nothing before it but this
    if (typeof txt === "string") {
      var at0 = frameOf(probe.stack, 0), idx = txt.indexOf("@hermes-bridge-" + "probe@");
      if (at0 && idx >= 0) {
        self.k = txt.split("\n").length - 1;
        self.head = at0.line - txt.slice(0, idx).split("\n").length + 1;
        self.url = String(at0.url).split("#")[0];
      }
    }
  } catch (_) {}

  var port = null, seq = 0, pending = new Map(), queue = [], queuedEvents = 0, failed = false, listeners = {};
  var hostAccent = null; // Hermes' accent (the host sends its theme), for the page's marks
  var hostV = 0; // the protocol the host's port message names (Hermes Desktop 2, the browser viewer 1; 3: wants "alive")
  var MAX_QUEUED_EVENTS = 50;

  function offlineError(msg) { var e = new Error(msg); e.__hermesOffline = true; return e; }
  function call(op, args) {
    return new Promise(function (resolve, reject) {
      if (failed) return reject(offlineError("hermes bridge unavailable (page not opened inside the artifact viewer)"));
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      var msg = { id: id, op: op, args: args || {} };
      port ? port.postMessage(msg) : queue.push(msg);
    });
  }
  function emit(event, detail) { // page -> host, no answer expected
    var msg = { event: event, detail: detail };
    if (port) port.postMessage(msg);
    else if (queuedEvents < MAX_QUEUED_EVENTS) { queuedEvents++; queue.push(msg); }
  }
  function send(msg) { try { if (port) port.postMessage(msg); } catch (_) {} }
  // An event that comes before anyone listens (the port can arrive while the page is still loading)
  // is kept, and the first listener for it gets the last one.
  var early = {};
  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    if (Object.prototype.hasOwnProperty.call(early, name)) {
      var d = early[name]; delete early[name];
      setTimeout(function () { try { fn(d); } catch (_) {} }, 0);
    }
  }
  function fire(name, detail) {
    var ls = listeners[name];
    if (!ls || !ls.length) { early[name] = detail; return; }
    ls.forEach(function (fn) { try { fn(detail); } catch (_) {} });
  }

  window.addEventListener("message", function (e) {
    // Trust is by source: only our direct parent may hand us the port.
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.__hermes_bridge !== 1 || d.kind !== "port" || !e.ports || !e.ports[0]) return;
    port = e.ports[0];
    failed = false; // a port after the timeout: the page works again from here on
    hostV = typeof d.v === "number" ? d.v : 0;
    port.onmessage = function (ev) {
      var r = ev.data;
      if (r && r.event) {
        if (r.event === "theme") { var ta = r.detail && r.detail.vars && r.detail.vars.accent; if (typeof ta === "string" && /^(rgb|#)/.test(ta)) hostAccent = ta; }
        fire(r.event, r.detail);
        return;
      }
      var p = pending.get(r && r.id);
      if (!p) return;
      pending.delete(r.id);
      r.ok ? p.resolve(r.value) : p.reject(new Error(r.error || "bridge error"));
    };
    queue.splice(0).forEach(function (m) { port.postMessage(m); });
    queuedEvents = 0;
    deliver();
    startAlive();
  });

  // Degraded: no host. Calls fail at once from here on (and the ones waiting fail now); the page still
  // shows what it has, and a type runtime says so once (kit listens for "offline").
  function goOffline() {
    if (port || failed) return;
    failed = true;
    queue.splice(0).forEach(function (m) {
      if (m.event) return;
      var p = pending.get(m.id); pending.delete(m.id);
      p && p.reject(offlineError("hermes bridge unavailable"));
    });
    queuedEvents = 0;
    fire("offline", {});
  }
  if (window.parent !== window) {
    // The hello carries no data, so "*" is safe; the reply is checked by source above.
    try { window.parent.postMessage({ __hermes_bridge: 1, kind: "hello", v: PROTOCOL }, "*"); } catch (_) {}
    setTimeout(goOffline, 10000);
  } else goOffline(); // opened on its own: there is no host to wait for

  // --- where an error happened, in the version's own files ------------------------------------
  // "at" is "<file path within the version>:<line>[:<col>]", only when that is true: the browser viewer
  // loads the version's files by URL (/c/<id>/v<N>/<path>); Hermes Desktop shows one document the server
  // made, whose lines the server maps back to the page's file (#hermes-lines, pages only); type runtimes
  // name the version files they run as code (window.__hermesEval). Anything else has no "at".
  function frameOf(stack, skip) { // the n-th "url:line:col" frame of an Error's stack
    var lines = String(stack || "").split("\n"), n = 0;
    for (var i = 0; i < lines.length; i++) {
      var f = parseFrame(lines[i]);
      if (f && n++ >= skip) return f;
    }
    return null;
  }
  function parseFrame(s) {
    var m = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(s) || /^(.*?)@(.+?):(\d+):(\d+)\s*$/.exec(s);
    if (!m || /^eval at /.test(m[2])) return null;
    return { fn: m[1] || "", url: m[2], line: +m[3], col: +m[4] };
  }
  function bare(u) { var i = String(u || "").indexOf("#"); return i < 0 ? String(u || "") : String(u).slice(0, i); }
  var DOC = bare(location.href);
  var VB = (function () {
    var m = /^(https?:\/\/[^/]+\/c\/[^/]+\/v\d+\/)([^?#]*)/.exec(DOC);
    if (!m) return null;
    try { return { base: m[1], rel: decodeURIComponent(m[2]) || "index.html" }; } catch (_) { return null; }
  })();
  var map = null;
  function lineMap() { // [first line in the document, first line in the file, count] blocks, from the server
    if (map) return map.m ? map : null;
    map = {};
    try {
      var el = document.getElementById("hermes-lines");
      var j = el && JSON.parse(el.textContent);
      if (j && typeof j.f === "string" && Array.isArray(j.m)) map = j;
    } catch (_) {}
    return map.m ? map : null;
  }
  function typed() { return !!document.getElementById("hermes-artifact-content"); }
  function shortUrl(u) {
    u = String(u || "");
    if (/^data:/i.test(u)) return u.slice(0, Math.max(5, u.search(/[;,]/))) + ",\u2026";
    if (VB && u.indexOf(VB.base) === 0) return u.slice(VB.base.length);
    return u.length > 200 ? u.slice(0, 200) + "\u2026" : u;
  }
  function isDoc(u) { u = bare(u); return !u || u === DOC || (self.url && u === self.url); }
  /** {at} for a place in the version's files; {bridge} for this script; else {name} to show in a stack. */
  function place(url, line, col) {
    line = +line; col = +col || 0;
    if (!(line > 0)) return null;
    var lc = function (l, c) { return l + (c > 0 ? ":" + c : ""); };
    if (isDoc(url)) {
      var name = { name: "(document):" + lc(line, col) };
      if (self.head < 0) return name;
      var s = line, c = col;
      if (line >= self.head && line < self.head + self.k) return { bridge: true, name: "(hermes bridge)" };
      if (line >= self.head) { s = line - self.k; if (line === self.head + self.k) c = 0; }
      var lm = lineMap();
      if (lm) {
        for (var i = 0; i < lm.m.length; i++) {
          var b = lm.m[i];
          if (s >= b[0] && s < b[0] + b[2]) return { at: lm.f + ":" + lc(b[1] + s - b[0], c) };
        }
        return name;
      }
      if (VB && !typed()) return { at: VB.rel + ":" + lc(s, c) };
      return name;
    }
    url = String(url);
    if (VB && url.indexOf(VB.base) === 0) {
      var rel = url.slice(VB.base.length).split(/[?#]/)[0];
      try { rel = decodeURIComponent(rel); } catch (_) {}
      return { at: rel + ":" + lc(line, col) };
    }
    var ev = window.__hermesEval;
    if (ev && typeof ev === "object") {
      for (var p in ev) {
        if (!Object.prototype.hasOwnProperty.call(ev, p) || url.indexOf(p) !== 0) continue;
        var o = ev[p] || {}, l = line - (o.lines | 0), path = o.strip ? url.slice(p.length) : url;
        if (l > 0 && path) return { at: path + ":" + lc(l, l === 1 ? 0 : col) }; // line 1 carries the runtime's wrapper
      }
    }
    return { name: shortUrl(url) + ":" + lc(line, col) };
  }

  // --- the page's errors, for the host ("diag") ---------------------------------------------------
  var MAX_DISTINCT = 20;
  var RO_LOOP = /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i;
  var diag = { list: [], index: {}, dropped: 0, sentDropped: 0, timer: 0, drop: { posts: 0, last: 0 } };
  var seenObjs = typeof WeakSet === "function" ? new WeakSet() : null; // thrown values already recorded
  var capturing = false;
  function clean(s, n) {
    return String(s == null ? "" : s).replace(/data:[^\s,;)'"]*[;,][^\s)'"]{24,}/gi, function (d) { return shortUrl(d); }).slice(0, n);
  }
  function errText(x) {
    if (x && typeof x === "object" && typeof x.message === "string") return (x.name ? x.name + ": " : "") + x.message;
    if (typeof x === "string") return x;
    try { var j = JSON.stringify(x); if (j !== undefined) return j; } catch (_) {}
    return String(x);
  }
  function remember(x) { try { if (seenObjs && x && typeof x === "object") seenObjs.add(x); } catch (_) {} }
  function seen(x) { try { return !!(seenObjs && x && typeof x === "object" && seenObjs.has(x)); } catch (_) { return false; } }
  /** Keep one occurrence. e: {k, m, url?, line?, col?, stack?, tag?, src?}: where it happened is worked out
   *  when it is sent (the document has been read by then). */
  function record(e) {
    var where = e.line ? (isDoc(e.url) ? "#doc" : String(e.url).slice(0, 300)) + ":" + e.line + ":" + (e.col || 0) : "";
    var m = clean(e.m, 300), key = e.k + "\u0000" + m + "\u0000" + where;
    var have = diag.index[key];
    if (have) have.n++;
    else if (diag.list.length >= MAX_DISTINCT) diag.dropped++;
    else { e.m = m; e.n = 1; e.sent = 0; diag.list.push(e); diag.index[key] = e; }
    if (!diag.timer) diag.timer = setTimeout(function () { diag.timer = 0; flushDiag(); }, 1000);
  }
  function resolve(e) {
    if (e.out) return e.out;
    var o = { k: e.k, m: e.m }, top = e.line ? place(e.url, e.line, e.col) : null, frames = [];
    String(e.stack || "").split("\n").forEach(function (s) {
      var f = parseFrame(s);
      if (!f) return;
      var p = place(f.url, f.line, f.col);
      if (!p || p.bridge) return;
      if (!top || !top.at) { if (p.at) top = p; }
      if (frames.length < 3) frames.push("at " + (f.fn ? f.fn + " (" : "") + (p.at || p.name) + (f.fn ? ")" : ""));
    });
    if (top && top.at) o.at = clean(top.at, 200);
    if (frames.length) o.stack = frames.map(function (s) { return clean(s, 200); });
    if (e.tag) o.tag = String(e.tag).slice(0, 20);
    if (e.src) o.url = clean(shortUrl(e.src), 500);
    return (e.out = o);
  }
  // A count that keeps rising (the same error in a loop) is posted the first few times, then at most every
  // 30 s, so a hot loop makes no steady stream of posts (and of writes on the server).
  var EAGER_POSTS = 3, DAMPED_MS = 30000;
  function clock() { return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(); }
  function due(rec, force) { return force || (rec.posts || 0) < EAGER_POSTS || clock() - rec.last >= DAMPED_MS; }
  function flushDiag(force) {
    if (!port || document.readyState === "loading") return; // the line map is read once the document is
    var out = [], now = clock(), wait = 0;
    var later = function (rec) { var w = DAMPED_MS - (now - rec.last); if (!wait || w < wait) wait = w; };
    diag.list.forEach(function (e) {
      if (e.n <= e.sent) return;
      if (!due(e, force)) return later(e);
      var o = resolve(e), c = {};
      for (var k in o) c[k] = o[k];
      c.n = e.n - e.sent; e.sent = e.n; e.posts = (e.posts || 0) + 1; e.last = now;
      out.push(c);
    });
    var dropped = 0;
    if (diag.dropped > diag.sentDropped) {
      if (due(diag.drop, force)) {
        dropped = diag.dropped - diag.sentDropped;
        diag.sentDropped = diag.dropped; diag.drop.posts = (diag.drop.posts || 0) + 1; diag.drop.last = now;
      } else later(diag.drop);
    }
    if (out.length || dropped) send({ event: "diag", detail: { entries: out, dropped: dropped } });
    // what was held back goes out when its 30 s are up, even if nothing new comes
    if (wait > 0 && !diag.timer) diag.timer = setTimeout(function () { diag.timer = 0; flushDiag(); }, wait);
  }
  function guard(fn) { return function (ev) { if (capturing) return; capturing = true; try { fn(ev); } catch (_) {} capturing = false; }; }

  window.addEventListener("error", guard(function (e) {
    var t = e && e.target;
    if (t && t !== window && t.nodeType === 1) { // a resource that failed to load
      if (t.hasAttribute && t.hasAttribute("data-hermes-ui")) return;
      var tag = String(t.tagName || "").toLowerCase(), src = t.currentSrc || t.src || t.href || t.getAttribute && (t.getAttribute("src") || t.getAttribute("href")) || "";
      record({ k: "resource", m: tag + " failed to load" + (src ? ": " + shortUrl(src) : ""), tag: tag, src: String(src || "") });
      return;
    }
    var msg = String(e.message || "");
    // Chrome's notice that a ResizeObserver callback changed sizes again within one frame: no error of the
    // page's code (nothing threw), and it repeats every frame. Not recorded, never "threw".
    if (RO_LOOP.test(msg)) return;
    if (seen(e.error)) return;
    remember(e.error);
    if (!e.error && !e.filename && !e.lineno && /^(Uncaught )?Script error\.?$/i.test(msg)) {
      // a cross-origin script's error with nothing in it: noted once, and not taken for a failed start
      record({ k: "console", m: "Script error. (a cross-origin script; the browser gives no details)" });
      return;
    }
    var stack = e.error && e.error.stack;
    record({ k: "error", m: msg || errText(e.error) || "error", url: e.filename || "", line: e.lineno, col: e.colno, stack: stack });
    threw();
  }), true);
  window.addEventListener("unhandledrejection", guard(function (e) {
    var r = e && e.reason;
    if (r && r.__hermesOffline) return; // the host is absent: that is no fault of the page
    if (seen(r)) return;
    remember(r);
    var f = r && r.stack ? frameOf(r.stack, 0) : null;
    record({ k: "rejection", m: "Unhandled rejection: " + errText(r), url: f ? f.url : "", line: f ? f.line : 0, col: f ? f.col : 0, stack: r && r.stack });
    threw();
  }));
  document.addEventListener("securitypolicyviolation", guard(function (e) {
    var dir = e.effectiveDirective || e.violatedDirective || "csp", blocked = e.blockedURI || "";
    record({ k: "csp", m: dir + " blocked " + (blocked ? shortUrl(blocked) : "content"), url: e.sourceFile || "", line: e.lineNumber, col: e.columnNumber, src: blocked });
  }), true);
  (function () {
    var orig = console.error;
    if (typeof orig !== "function") return;
    console.error = function () {
      var args = arguments;
      if (!capturing) {
        capturing = true;
        try {
          var parts = [], err = null, offline = false;
          for (var i = 0; i < args.length; i++) {
            var a = args[i];
            if (a && a.__hermesOffline) offline = true;
            if (a && typeof a === "object" && typeof a.stack === "string" && !err) err = a;
            parts.push(errText(a));
          }
          var msg = parts.join(" ");
          if (!offline && !(err && seen(err)) && !/hermes bridge unavailable/.test(msg) && !RO_LOOP.test(msg)) {
            if (err) remember(err);
            // where it was logged from: the thrown value's own place, else the caller (frame 0 is this wrapper)
            var stack = err ? err.stack : new Error().stack, f = stack ? frameOf(stack, err ? 0 : 1) : null;
            record({ k: "console", m: msg || "console.error", url: f ? f.url : "", line: f ? f.line : 0, col: f ? f.col : 0, stack: stack });
          }
        } catch (_) {}
        capturing = false;
      }
      return orig.apply(this, args);
    };
  })();

  // --- ready: once per load -------------------------------------------------------------------------
  // At window load or 2 s after DOMContentLoaded, whichever comes first (a picture or frame that loads
  // slowly or never must not hold it), plus two frames; a type runtime that set window.__hermesDefer = true
  // before load says it itself (kit.ready() -> hermes.ready()) after its first real render. An uncaught error
  // or rejection before then makes it {threw: true}; a deferred runtime that threw is not waited for (1 s
  // after the error, once the page has loaded). {blank: true}: see isBlank().
  var rd = { msg: null, posted: false, threw: false, asked: false, loaded: false, timer: 0, started: false };
  var READY_AFTER_PARSE_MS = 2000, BLANK_SCAN = 400;
  var NOT_CONTENT = { HTML: 1, HEAD: 1, BODY: 1, SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TEMPLATE: 1, TITLE: 1, NOSCRIPT: 1, BASE: 1 };
  /** True when the page shows nothing a user could see: no text in the body and none of the first
   *  BLANK_SCAN elements (other than html/body/script/style/link/meta/template...) has a box with an area.
   *  Canvas, svg, img, video, iframe count with their box. Reaching the scan cap counts as not blank. */
  function isBlank() {
    try {
      var b = document.body;
      if (!b) return true;
      if (String(b.innerText || "").trim()) return false;
      var all = b.getElementsByTagName("*");
      if (all.length > BLANK_SCAN) return false;
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (NOT_CONTENT[String(el.tagName).toUpperCase()] || (el.hasAttribute && el.hasAttribute("data-hermes-ui"))) continue;
        var w = el.offsetWidth, h = el.offsetHeight;
        if (typeof w !== "number" && el.getBoundingClientRect) { var r = el.getBoundingClientRect(); w = r.width; h = r.height; }
        if (w * h > 0) return false;
      }
      return true;
    } catch (_) { return false; }
  }
  function afterPaint(fn) { // two frames, or 1 s where no frame is drawn (a hidden page)
    var done = false, go = function () { if (!done) { done = true; fn(); } };
    try { requestAnimationFrame(function () { requestAnimationFrame(go); }); } catch (_) {}
    setTimeout(go, 1000);
  }
  function whenParsed(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", function () { fn(); });
  }
  function readyNow() {
    if (rd.msg) return;
    rd.msg = { event: "ready", detail: { threw: rd.threw, blank: isBlank(), t: Math.round(clock()) } };
    deliver();
  }
  function deliver() { // what waits for the port: the errors so far, then ready
    if (!port) return;
    flushDiag();
    if (rd.msg && !rd.posted && document.readyState !== "loading") { rd.posted = true; send(rd.msg); }
  }
  function threw() {
    if (rd.msg) return;
    rd.threw = true;
    if (window.__hermesDefer && rd.loaded && !rd.timer) rd.timer = setTimeout(readyNow, 1000);
  }
  function settle() {
    if (rd.started) return;
    rd.started = true;
    afterPaint(function () {
      rd.loaded = true;
      if (!window.__hermesDefer || rd.threw) readyNow();
    });
  }
  window.addEventListener("load", settle);
  document.addEventListener("DOMContentLoaded", function () { deliver(); setTimeout(settle, READY_AFTER_PARSE_MS); });
  function hermesReady() {
    if (!window.__hermesDefer || rd.asked) return; // not deferred: load decides
    rd.asked = true;
    whenParsed(function () { afterPaint(readyNow); });
  }

  // --- alive: every 2 s while the page's main thread runs (a hung page stops it) --------------------
  var aliveTimer = 0;
  function startAlive() {
    if (aliveTimer || !port || hostV < 3) return;
    send({ event: "alive", detail: null });
    aliveTimer = setInterval(function () { send({ event: "alive", detail: null }); }, 2000);
  }
  function stopAlive() { if (aliveTimer) { clearInterval(aliveTimer); aliveTimer = 0; } }
  window.addEventListener("pagehide", function () { try { flushDiag(true); } catch (_) {} stopAlive(); });
  window.addEventListener("pageshow", function (e) { if (e && e.persisted) startAlive(); });

  // --- links to the artifact's other pages (multi-file artifacts) ---------------------------
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("[data-hermes-page]");
    if (!a || picking) return;
    e.preventDefault();
    call("navigate", { page: a.getAttribute("data-hermes-page") }).catch(function () {});
  }, true);

  // --- comments: the host turns pick mode on, the page reports the element clicked ----------
  var picking = false, hoverBox = null, pins = [];
  function selectorOf(el) {
    if (!el || el === document.body || el === document.documentElement) return "body";
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return "#" + el.id;
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 8) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift("#" + el.id); break; }
      var tag = el.tagName.toLowerCase(), i = 1, s = el;
      while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++;
      parts.unshift(tag + ":nth-of-type(" + i + ")");
      el = el.parentElement;
    }
    return parts.join(" > ");
  }
  function mark() { return hostAccent || "#6b7280"; }
  function box(color) {
    var b = document.createElement("div");
    b.setAttribute("data-hermes-ui", "");
    // Hermes' accent, with a light halo so it reads on light and dark pages alike.
    b.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid " + color +
      ";border-radius:6px;background:color-mix(in srgb," + color + " 10%,transparent);box-shadow:0 0 0 3px rgba(255,255,255,.35);transition:all .06s";
    document.documentElement.appendChild(b);
    return b;
  }
  function place2(b, el) {
    var r = el.getBoundingClientRect();
    b.style.left = r.left - 2 + "px"; b.style.top = r.top - 2 + "px";
    b.style.width = r.width + "px"; b.style.height = r.height + "px";
  }
  function onMove(e) {
    if (!picking) return;
    var el = e.target;
    if (!el || el.hasAttribute("data-hermes-ui")) return;
    hoverBox = hoverBox || box(mark());
    place2(hoverBox, el);
  }
  function onPick(e) {
    if (!picking) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target, r = el.getBoundingClientRect();
    var text = (el.innerText || el.textContent || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ");
    emit("picked", { selector: selectorOf(el), text: text.slice(0, 200), label: el.tagName.toLowerCase(),
                     rect: { x: r.left, y: r.top, w: r.width, h: r.height } });
  }
  function setPicking(on) {
    picking = !!on;
    document.documentElement.style.cursor = picking ? "crosshair" : "";
    if (picking) document.documentElement.setAttribute("data-commenting", "1"); else document.documentElement.removeAttribute("data-commenting");
    if (!picking && hoverBox) { hoverBox.remove(); hoverBox = null; }
  }
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onPick, true);
  on("comment-mode", function (d) { setPicking(d && d.on); });
  on("pins", function (items) { // [{selector, n}] numbered badges on commented elements
    pins.forEach(function (p) { p.remove(); }); pins = [];
    if (document.documentElement.hasAttribute("data-own-pins")) return; // the page draws its own (a doc's margin cards)
    (items || []).forEach(function (it) {
      var el; try { el = document.querySelector(it.selector); } catch (_) {}
      if (!el) return;
      var r = el.getBoundingClientRect(), b = document.createElement("div");
      b.setAttribute("data-hermes-ui", "");
      b.textContent = String(it.n);
      b.style.cssText = "position:absolute;z-index:2147483645;min-width:18px;height:18px;padding:0 5px;" +
        "border-radius:9px;background:" + mark() + ";color:#fff;font:600 11px/18px system-ui,sans-serif;" +
        "text-align:center;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.3)";
      b.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); emit("pinOpen", { n: it.n }); });
      b.style.left = r.right + window.scrollX - 9 + "px"; b.style.top = r.top + window.scrollY - 9 + "px";
      document.body.appendChild(b); pins.push(b);
    });
  });
  on("flash", function (d) {
    var el; try { el = document.querySelector(d && d.selector); } catch (_) {}
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    var b = box(mark()); place2(b, el);
    setTimeout(function () { place2(b, el); }, 350);
    setTimeout(function () { b.remove(); }, 1600);
  });

  window.hermes = Object.freeze({
    platform: "hermes-artifacts",
    version: 2,
    storage: Object.freeze({
      get: function (key) { return call("storage.get", { key: key }).then(function (r) { return r.value; }); },
      set: function (key, value) { return call("storage.set", { key: key, value: value }).then(function () {}); },
      remove: function (key) { return call("storage.set", { key: key, value: null }).then(function () {}); },
      list: function () { return call("storage.list").then(function (r) { return r.keys; }); }
    }),
    /** Into the artifact's chat. By default it is put in the chat's message box for the user to send (Claude's
     *  stage_in_chat); {deliver: "send"} asks the user to confirm, then sends it. */
    send: function (text, data, opts) {
      return call("send", { text: String(text), data: data === undefined ? null : data, deliver: opts && opts.deliver === "send" ? "send" : "stage" });
    },
    /** Ask Hermes and wait for its answer: resolves with {text, data} once it replies. */
    ask: function (text, data) { return call("ask", { text: String(text), data: data === undefined ? null : data }); },
    /** Call an allowlisted Hermes tool (browser viewer only). */
    callTool: function (name, args) { return call("callTool", { name: name, args: args || {} }); },
    /** Download a file the page made: hermes.download("report.csv", text, "text/csv"). */
    download: function (name, content, type) {
      return call("download", { name: String(name), content: content, type: type || "application/octet-stream" });
    },
    /** Dashboards only: run a live dataset's stored call; decline it; approve(id or [ids]) asks Hermes Desktop,
     *  which shows the stored calls in its own dialog and resolves {allowed} with the user's answer. */
    dataset: Object.freeze({
      run: function (id, params, force, version, mode) {
        return call("dataset.run", { id: String(id), params: params || {}, force: !!force, version: version || null,
          mode: mode === "cached" ? "cached" : "live" });
      },
      approve: function (id, version) {
        return call("dataset.approve", Array.isArray(id) ? { ids: id.map(String), version: version || null } : { id: String(id), version: version || null });
      },
      decline: function (id, version) { return call("dataset.decline", { id: String(id), version: version || null }); },
      /** Sources' Test: run edited args without saving (needs a click). */
      test: function (id, args, params) { return call("dataset.test", { id: String(id), args: args, params: params || {} }); },
      /** A loader's call(tool, args): another tool of the dataset's own connector. */
      call: function (id, tool, args, version) { return call("dataset.call", { id: String(id), tool: String(tool), args: args || {}, version: version }); },
      /** Sources' history of a live query's args. */
      history: function (id) { return call("dataset.history", { id: String(id) }).then(function (r) { return r.entries; }); },
      /** The user editing a live query in Sources: new args for that dataset, saved as a new version. */
      edit: function (id, args, baseVersion) { return call("dataset.edit", { id: String(id), args: args, base_version: baseVersion || null }); }
    }),
    /** Design systems: get(id, version) one to build on (none: the default one; {none: true} when there is none;
     *  version: the one the artifact was built on, else the latest);
     *  makeDefault(on) from a design system's own page. */
    ds: Object.freeze({
      get: function (id, version) { return call("ds.get", { id: id || null, version: typeof version === "number" ? version : null }); },
      makeDefault: function (on) { return call("ds.default", { on: on !== false }); }
    }),
    /** Docs: the live doc on the server (read a tab, edit blocks, ask Hermes in the doc). */
    doc: Object.freeze({
      read: function (tab, sinceRev) { return call("doc.read", { tab: tab || null, since_rev: sinceRev == null ? null : sinceRev }); },
      edit: function (tab, ops, baseRev) { return call("doc.edit", { tab: tab || null, ops: ops, base_rev: baseRev == null ? null : baseRev }); },
      ask: function (a) { return call("doc.ask", a || {}); },
      history: function (tab) { return call("doc.history", { tab: tab || null }); },
      restore: function (tab, rev) { return call("doc.restore", { tab: tab || null, rev: rev }); },
      /** Suggesting mode: propose ops instead of making them; the person accepts or rejects each. */
      suggest: function (tab, ops) { return call("doc.suggest", { tab: tab || null, ops: ops }); },
      decide: function (id, verdict) { return call("doc.decide", { id: id, verdict: verdict }); },
      /** A picture put in the doc (data URL) -> {src: "doc:<name>"}; file(name) -> {url} to show it. */
      upload: function (dataUrl) { return call("doc.upload", { data: dataUrl }); },
      file: function (name) { return call("doc.file", { name: name }); }
    }),
    /** Sheets: the live workbook on the server (read a sheet, edit it with ops, hand back computed values). */
    sheet: Object.freeze({
      read: function (sheet, sinceRev) { return call("sheet.read", { sheet: sheet || null, since_rev: sinceRev == null ? null : sinceRev }); },
      edit: function (sheet, ops, baseRev) { return call("sheet.edit", { sheet: sheet || null, ops: ops, base_rev: baseRev == null ? null : baseRev }); },
      vals: function (sheet, rev, vals) { return call("sheet.vals", { sheet: sheet || null, rev: rev, vals: vals || {} }); },
      history: function (sheet) { return call("sheet.history", { sheet: sheet || null }); },
      at: function (sheet, rev) { return call("sheet.at", { sheet: sheet || null, rev: rev }); },
      restore: function (sheet, rev) { return call("sheet.restore", { sheet: sheet || null, rev: rev }); },
      ask: function (a) { return call("sheet.ask", a || {}); }
    }),
    /** Boards: the live whiteboard on the server (read it, or what changed since a rev; edit it with ops). */
    board: Object.freeze({
      read: function (sinceRev) { return call("board.read", { since_rev: sinceRev == null ? null : sinceRev }); },
      edit: function (ops, baseRev) { return call("board.edit", { ops: ops, base_rev: baseRev == null ? null : baseRev }); },
      history: function () { return call("board.history", {}); },
      at: function (rev) { return call("board.at", { rev: rev }); },
      restore: function (rev) { return call("board.restore", { rev: rev }); },
      ask: function (a) { return call("board.ask", a || {}); }
    }),
    /** History (Claude's): the versions, one version's changes, Restore (needs a click), and showing a
     *  version in place (null = the latest). */
    history: Object.freeze({
      list: function () { return call("history.list", {}).then(function (r) { return r.versions; }); },
      diff: function (v) { return call("history.diff", { version: v }); },
      restore: function (v) { return call("history.restore", { version: v }); },
      show: function (v, panel) { return call("showVersion", { version: v == null ? null : v, panel: panel || null }); }
    }),
    /** Full screen for the artifact (the host fills the window; Esc leaves). */
    fullscreen: function (on) { return call("present", { on: on !== false }); },
    /** Start a comment on a part of the page (the host opens its comment form there). */
    comment: function (anchor) { emit("comment", anchor || {}); },
    /** Type runtimes only: a vendored export library's source text (loaded on demand). */
    vendor: function (name) { return call("vendor", { name: String(name) }).then(function (r) { return r.text; }); },
    /** Type runtimes only (slides, doc): save edited files as a new version. */
    save: function (files, baseVersion) { return call("save", { files: files, base_version: baseVersion || null }); },
    /** Type runtimes: a picture of the version shown (a PNG data URL, at most 400 KB) for the gallery's card;
     *  version: the one drawn (nothing is kept when a newer one exists). Makes no version. */
    preview: function (dataUrl, version) { return call("preview.set", { data: String(dataUrl), version: typeof version === "number" ? version : null }); },
    /** Type runtimes: tell the host which exports to offer in its toolbar ([{id, label}]); the host
     *  then sends an "export" event with the id the user picked. */
    chrome: function (opts) { return call("chrome", opts || {}); },
    /** Type runtimes: where the user is in the page (sent along with their next chat message). */
    view: function (context) { return call("view", { context: context || {} }); },
    /** Type runtimes: report what the page found ("check") and how its sources ran ("runs"). */
    report: function (kind, data) { return call("report", { kind: String(kind), data: data || {} }); },
    /** Dashboards: open Hermes' Connectors page at a server, to sign in again or turn it on. */
    connectors: function (server) { return call("connectors", { server: server ? String(server) : "" }); },
    /** Dashboards: show, in the host's own dialog, the command that lets this plugin call the MCP servers
     *  the dashboard needs (the host gets it from the server; nothing the page passes goes into it). */
    allowlist: function () { return call("allowlist", {}); },
    /** Slides: present full screen (the host makes the frame fill the window and goes full screen). */
    present: function (on) { return call("present", { on: !!on }); },
    /** Host events for type runtimes (e.g. "theme"); "offline" when no host answered (the page's own). */
    on: on,
    /** Open a comment thread in the host's panel (a page that draws its own comment marks). */
    openPin: function (n) { emit("pinOpen", { n: Number(n) || 0 }); },
    /** Type runtimes that set window.__hermesDefer = true before load: the first real render is on screen
     *  (kit.ready() calls it). Once per load; ignored when not deferred. */
    ready: hermesReady
  });
})();
