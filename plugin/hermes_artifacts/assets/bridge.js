/* Injected into every artifact page. Talks only to the parent shell over a MessagePort. */
(function () {
  if (window.hermes) return;
  // Protocol 4 (the hello's v): besides ops and events, the page sends the host "ready" (once per load),
  // "diag" (the page's errors) and, when the host's port message says v >= 3, "alive" every 2 s; and (4) says
  // "pick-ready" when picking is on, its click picks (the host holds a click until then: "pick-at").
  // Pages with an older bridge (hello v 2 or none) send none of them.
  //   ready  {threw, blank, t}: threw = an uncaught error or rejection came before it; blank = the page showed
  //          nothing a user could see when it was sent (isBlank()); t = ms since the page started.
  //   diag   {entries: [{k, m, at?, n, stack?, tag?, url?}], dropped}: n and dropped count since the last post.
  //   alive  null.
  //   press  null: a press in the page (the host's own menus close on it, as on a press anywhere outside them).
  var PROTOCOL = 4;
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

  // A plain page's scrollbars in the host's theme (thin, its colours), as the type runtimes' are, only when the
  // page styles none of its own. One <style> put first into <head> by the DOM (no line of the document moves),
  // every selector in :where() (specificity 0, first in order): any rule of the page wins. Not in an export (no
  // bridge there), not in a type runtime (the kit styles its own).
  var hostBars = null, BARS_ID = "hermes-scrollbars", OWN_BARS = /scrollbar-(color|width)|::?-webkit-scrollbar/i;
  function barColour(c) { return typeof c === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d.,%\s\/]+\))$/i.test(c) ? c : null; }
  function ownScrollbars() {
    var i, n = document.querySelectorAll("style, [style]");
    for (i = 0; i < n.length; i++) {
      if (n[i].id === BARS_ID) continue;
      if (OWN_BARS.test(n[i].tagName === "STYLE" ? n[i].textContent : n[i].getAttribute("style") || "")) return true;
    }
    var sheets = document.styleSheets || [];
    for (i = 0; i < sheets.length; i++) {
      var s = sheets[i];
      if (s.ownerNode && s.ownerNode.tagName === "STYLE") continue; // read above
      try { for (var j = 0; j < s.cssRules.length; j++) if (OWN_BARS.test(s.cssRules[j].cssText)) return true; } catch (_) {} // another origin's: unread
    }
    return false;
  }
  function scrollbars() {
    try {
      if (!hostBars || document.readyState === "loading") return; // DOMContentLoaded comes back here
      var mine = document.getElementById(BARS_ID);
      var thumb = barColour(hostBars.muted) || barColour(hostBars.strong), track = barColour(hostBars.bg);
      if (document.getElementById("hermes-artifact-content") || !thumb || ownScrollbars()) { if (mine) mine.remove(); return; }
      var css = ":where(*){scrollbar-width:thin;scrollbar-color:" + thumb + " transparent}" +
        (track ? ":where(:root){scrollbar-color:" + thumb + " " + track + "}" : "");
      if (!mine) {
        mine = document.createElement("style");
        mine.id = BARS_ID;
        var head = document.head || document.documentElement;
        head.insertBefore(mine, head.firstChild);
      }
      if (mine.textContent !== css) mine.textContent = css;
    } catch (_) {}
  }
  document.addEventListener("DOMContentLoaded", scrollbars);

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
  // First of the page's listeners: a press the page or the pick stops still reaches the host (V6f: the title's menu
  // stayed open over a press in the page).
  window.addEventListener("pointerdown", function () { send({ event: "press", detail: null }); }, true);
  // An event that comes before anyone listens (the port can arrive while the page is still loading)
  // is kept, and the first listener for it gets the last one. A state the host sends once and again only
  // when it changes (STICKY: the comment threads) goes to every listener that comes later too: this bridge
  // listens to "pins" itself from the start, so a page's own listener (a doc's margin) would never get
  // threads sent before its script ran. Nor would a page's own pick (a deck's blank, a design's artboards) hear
  // that picking is on when the host armed it right after the frame opened ("comment-mode": the bridge listens
  // to it from the start too; V6d, the first pick of a deck just opened made no draft).
  var early = {}, last = {}, STICKY = { pins: 1, "comment-mode": 1 };
  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    var has = Object.prototype.hasOwnProperty;
    if (has.call(early, name) || has.call(last, name)) {
      var d = has.call(early, name) ? early[name] : last[name]; delete early[name];
      setTimeout(function () { try { fn(d); } catch (_) {} }, 0);
    }
  }
  function fire(name, detail) {
    if (STICKY[name]) last[name] = detail;
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
        if (r.event === "theme") {
          var ta = r.detail && r.detail.vars && r.detail.vars.accent; if (typeof ta === "string" && /^(rgb|#)/.test(ta)) hostAccent = ta;
          hostBars = r.detail && r.detail.vars; scrollbars();
        }
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

  // --- a gallery card (the host's <meta name="hermes-thumb"> before this script) ---------------------------
  // No host answers a card: its calls fail as above, and a page that calls in a loop would put an "Uncaught
  // (in promise)" into the console (and Hermes' log) at every call it does not catch. Those rejections are the
  // bridge's own (the host is absent), so a card keeps them out of the console. A card is a picture: a page's
  // timers (intervals, timeouts, animation frames) stop THUMB_FREEZE_MS after its load, so a page that redraws
  // every 100 ms does not run for as long as the gallery is open. Only pages: a type runtime's card (the kit
  // marks it data-thumb) draws until it says it is ready and is left alone. The real viewer has no such meta.
  var THUMB = !!document.querySelector('meta[name="hermes-thumb"]'), THUMB_FREEZE_MS = 3000;
  if (THUMB) {
    window.addEventListener("unhandledrejection", function (e) {
      if (e && e.reason && e.reason.__hermesOffline) e.preventDefault();
    });
    (function () {
      var sI = window.setInterval, cI = window.clearInterval, sT = window.setTimeout, rAF = window.requestAnimationFrame;
      var intervals = new Set(), frozen = false;
      window.setInterval = function () {
        if (frozen) return 0;
        var id = sI.apply(window, arguments);
        intervals.add(id);
        return id;
      };
      window.clearInterval = function (id) { intervals.delete(id); return cI.call(window, id); };
      window.setTimeout = function () { return frozen ? 0 : sT.apply(window, arguments); };
      if (typeof rAF === "function") window.requestAnimationFrame = function (fn) { return frozen ? 0 : rAF.call(window, fn); };
      function freeze() {
        if (document.documentElement.hasAttribute("data-thumb")) return; // a type runtime's card
        frozen = true;
        intervals.forEach(function (id) { cI.call(window, id); });
        intervals.clear();
      }
      window.addEventListener("load", function () { sT.call(window, freeze, THUMB_FREEZE_MS); });
    })();
  }

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
    sayPickReady(); // picking came before it
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
    // What a click there would pick: nothing on the page's blank (no box), else the element.
    hoverBox.style.display = blank(el, e.clientX, e.clientY) ? "none" : "";
    place2(hoverBox, el);
  }
  /** A click on none of the page's own content: the document itself, or a big box that holds blocks (the page,
   *  its column) where none of them is, with no words of its own (the blank under a doc's last block, the gap
   *  between a dashboard's tiles). Picks nothing: pick mode stays on. */
  function blank(el, x, y) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (!el.children.length || el.closest("[data-comment-label]")) return false; // in a part the page named (a slide)
    for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3 && /\S/.test(n.nodeValue)) return false; }
    for (i = 0; i < el.children.length; i++) {
      var k = el.children[i].getBoundingClientRect();
      if (x >= k.left && x <= k.right && y >= k.top && y <= k.bottom) return false;
    }
    var r = el.getBoundingClientRect();
    var seen = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return seen >= 0.4 * innerWidth * innerHeight;
  }
  // The host's new-comment pin (plugin.js PIN, PIN_GAP): beside the element, centred on its first line.
  var PIN = 26, PIN_GAP = 6, PIN_EDGE = 4, PIN_MIN = 16;
  /** The first line of the element's words, {top, height, left, right}; null when it has none (an image). */
  function firstLine(el) {
    try {
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n, rg = document.createRange(), line = null;
      for (var i = 0; (n = w.nextNode()) && i < 400; i++) {
        if (!/\S/.test(n.nodeValue)) continue;
        rg.selectNodeContents(n);
        var rs = rg.getClientRects();
        for (var j = 0; j < rs.length; j++) {
          var q = rs[j];
          if (!(q.height > 0 && q.width > 0)) continue;
          if (!line) line = { top: q.top, height: q.height, left: q.left, right: q.right };
          else if (q.top < line.top + line.height / 2) { line.left = Math.min(line.left, q.left); line.right = Math.max(line.right, q.right); } // the same line
          else return line;
        }
      }
      return line;
    } catch (_) {}
    return null;
  }
  /** Whether any of el's own words cross box. */
  function ownWords(el, box) {
    try {
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n, rg = document.createRange();
      for (var i = 0; (n = w.nextNode()) && i < 400; i++) {
        if (!/\S/.test(n.nodeValue)) continue;
        rg.selectNodeContents(n);
        var rs = rg.getClientRects();
        for (var j = 0; j < rs.length; j++) {
          var q = rs[j];
          if (q.width && q.height && q.left < box.r && q.right > box.l && q.top < box.b && q.bottom > box.t) return true;
        }
      }
    } catch (_) {}
    return false;
  }
  var SOLID = /^(IMG|INPUT|SELECT|TEXTAREA|BUTTON|SVG|CANVAS|VIDEO|IFRAME|svg)$/;
  /** Whether a pin at box {l, t, r, b} would cover anything of another element: its words, or a picture or
   *  control. The element itself, what holds it (the column, the body) and the plugin's own marks don't count. */
  function blocked(el, box) {
    var pts = [[(box.l + box.r) / 2, (box.t + box.b) / 2], [box.l + 1, box.t + 1], [box.r - 1, box.t + 1], [box.l + 1, box.b - 1], [box.r - 1, box.b - 1]];
    var seen = [];
    for (var p = 0; p < pts.length; p++) {
      var hits = document.elementsFromPoint ? document.elementsFromPoint(pts[p][0], pts[p][1]) : [];
      for (var k = 0; k < hits.length; k++) {
        var h = hits[k];
        if (seen.indexOf(h) >= 0 || h === el || h.contains(el) || el.contains(h) || h.closest("[data-hermes-ui]")) continue;
        seen.push(h);
        if (SOLID.test(h.tagName) || ownWords(h, box)) return true;
      }
    }
    return false;
  }
  /** The fixed or sticky box n is in (n itself, or one around it), or null. */
  function stuckBox(n) {
    for (; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      var pos = getComputedStyle(n).position;
      if (pos === "fixed" || pos === "sticky") return n;
    }
    return null;
  }
  /** The edge of the page's own bar across the line y (a fixed or sticky box along the band's top or bottom,
   *  most of the window wide, not over a third of it tall: a type page's toolbar), past which the band ends:
   *  its bottom (top) or its top (!top); null when none is there. el and its own bar do not count. */
  function barEdge(el, y, top) {
    var edge = null;
    for (var i = 1; i <= 5; i++) {
      var hits = document.elementsFromPoint ? document.elementsFromPoint(innerWidth * i / 6, y) : [];
      for (var k = 0; k < hits.length; k++) {
        if (hits[k].closest("[data-hermes-ui]")) continue;
        var bar = stuckBox(hits[k]);
        if (!bar || bar.contains(el)) continue;
        var b = bar.getBoundingClientRect();
        if (b.width < innerWidth * 0.6 || b.height > innerHeight / 3 || b.top > y || b.bottom < y) continue;
        edge = top ? Math.max(edge == null ? -Infinity : edge, b.bottom) : Math.min(edge == null ? Infinity : edge, b.top);
      }
    }
    return edge;
  }
  /** Where the host keeps the new comment's pin and box (vt, vb): the window, or the page's main box that el
   *  scrolls in (half the window tall or more: a sheet's grid under its toolbar, not a table's own scroll),
   *  less the page's own bars at its top and bottom. */
  function band(el) {
    var t = 0, b = innerHeight;
    for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1) {
        var pr = p.getBoundingClientRect();
        if (pr.height < innerHeight / 2) continue;
        t = Math.max(t, pr.top); b = Math.min(b, pr.bottom);
        break;
      }
    }
    for (var i = 0; i < 3; i++) { var nt = barEdge(el, t + 1, true); if (nt == null || nt <= t) break; t = nt; }
    for (i = 0; i < 3; i++) { var nb = barEdge(el, b - 1, false); if (nb == null || nb >= b) break; b = nb; }
    return { t: t, b: Math.max(t, b) };
  }
  /** Whether any of el can be seen: a point of its box inside the band shows el (or what is in it), not
   *  something over it (the page's bar, a pinned header row) nor what it scrolled out of. */
  function visible(el, r, bd) {
    var l = Math.max(r.left, 0), rr = Math.min(r.right, innerWidth), t = Math.max(r.top, bd.t), b = Math.min(r.bottom, bd.b);
    if (rr - l < 1 || b - t < 1 || !document.elementsFromPoint) return rr - l >= 1 && b - t >= 1;
    for (var i = 1; i <= 3; i++) for (var j = 1; j <= 3; j++) {
      var hits = document.elementsFromPoint(l + (rr - l) * i / 4, t + (b - t) * j / 4);
      for (var k = 0; k < hits.length; k++) {
        if (hits[k].closest("[data-hermes-ui]")) continue;
        if (hits[k] === el || el.contains(hits[k])) return true;
        break;
      }
    }
    return false;
  }
  /** The picked element for the host: its box (x, y, w, h), its first line (ly, lh, and lr where its words
   *  end), which of the pin's spots are free (the host's pinSpot tries them in this order): right (fr) and
   *  left (fl) of the box on that line, after the line's words (fw), above (fa) and below (fb) the box's
   *  right end; whether any of it can be seen (vis) and the band the host keeps the pin and its box in (vt,
   *  vb: band()); in a grid that keeps pins in its parts, where in it the pin goes (px: pinIn). A spot is free
   *  when no other element's words, picture or control is under it (fw: nor the element's own words). */
  function pickRect(el) { return rectOf(el, el.getBoundingClientRect(), firstLine(el), null); }
  /** pickRect for a box {x, y, w, h} in the window that a page measured itself (a part inside an artboard's own
   *  frame, a point of a film's picture), in `el` (what holds it there: the frame, the picture). The page may say
   *  where its first line is (ly, lh, lr) and which pin spots are taken inside el (fr, fl, fw, fa, fb: false,
   *  where it alone can see); point: true pins it on the box's middle (a point, not a part), seen when that
   *  point is (a box of no size is never "seen": the pin and the box went to the corner). */
  function boxRect(el, b) {
    var r = b.point ? { left: b.x + b.w / 2 - 0.5, top: b.y + b.h / 2 - 0.5, width: 1, height: 1 } : { left: b.x, top: b.y, width: b.w, height: b.h };
    r.right = r.left + r.width; r.bottom = r.top + r.height;
    var line = isFinite(b.ly) && isFinite(b.lh) && b.lh > 0 ? { top: b.ly, height: b.lh, right: isFinite(b.lr) ? b.lr : r.right } : null;
    var out = rectOf(el, r, line, b);
    if (!isFinite(b.lr)) { delete out.lr; delete out.fw; }
    if (b.point) out.pt = true;
    return out;
  }
  function rectOf(el, r, line, given) {
    var bd = band(el);
    var ly = line ? line.top : r.top, lh = line ? line.height : Math.min(r.height, 24);
    var t = Math.max(bd.t + PIN_EDGE, Math.min(bd.b - PIN - PIN_EDGE, ly + lh / 2 - PIN / 2));
    var at = function (l, tp) { return { l: l, t: tp, r: l + PIN, b: tp + PIN }; };
    var free = function (k, box) { return !(given && given[k] === false) && !blocked(el, box); };
    var R = r.right + PIN_GAP, L = r.left - PIN_GAP - PIN, end = r.right - PIN;
    var out = { x: r.left, y: r.top, w: r.width, h: r.height, ly: ly, lh: lh, vt: bd.t, vb: bd.b, vis: visible(el, r, bd),
                fr: free("fr", at(R, t)), fl: free("fl", at(L, t)),
                fa: free("fa", at(end, r.top - PIN_GAP - PIN)), fb: free("fb", at(end, r.bottom + PIN_GAP)) };
    if (line) {
      var wb = at(line.right + PIN_GAP, t);
      out.lr = line.right;
      out.fw = free("fw", wb) && (!!given || !ownWords(el, wb)); // a boolean: the host drops anything else
    }
    var grid = el.closest && el.closest("[data-comment-pin-in]");
    if (grid && grid !== el) out.px = pinIn(r, line);
    // the part the page named that holds el (a KPI whose number was picked): the box keeps off it where it can
    var part = el.closest && el.closest("[data-comment-label]");
    if (part && part !== el) { var q = part.getBoundingClientRect(); if (q.width >= 1 && q.height >= 1) out.pb = [q.left, q.top, q.right, q.bottom]; }
    var kp = keeps(el), kw = keptWords(el), kc = contentIn();
    if (kp.length) out.kp = kp;
    if (kw.length) out.kw = kw;
    if (kc.length) out.kc = kc;
    return out;
  }
  /** What is on the page in sight, for the comment's box to prefer empty room (kc): each line of words and each
   *  picture or control, [left, top, right, bottom] in the window, at most KC_MAX (the first in the page's order);
   *  a box out of sight is not looked into, nor one the page lets the box lie on ([data-comment-under]: a design's
   *  artboards on its canvas). */
  var KC_MAX = 160;
  function contentIn() {
    var out = [], seen = 0;
    var inSight = function (q) { return q.width >= 1 && q.height >= 1 && q.right > 0 && q.bottom > 0 && q.left < innerWidth && q.top < innerHeight; };
    var push = function (q) { out.push([Math.floor(q.left), Math.floor(q.top), Math.ceil(q.right), Math.ceil(q.bottom)]); };
    try {
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
        if (n.nodeType === 3) return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        if (n.hasAttribute("data-hermes-ui") || n.hasAttribute("data-comment-under") || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) return NodeFilter.FILTER_REJECT;
        var q = n.getBoundingClientRect(); // a box out of sight, or of no size, holds nothing seen (an overflow aside)
        if (!inSight(q) && getComputedStyle(n).overflow !== "visible") return NodeFilter.FILTER_REJECT;
        return SOLID.test(n.tagName) && inSight(q) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      } }), n, rg = document.createRange();
      while ((n = w.nextNode()) && out.length < KC_MAX && seen++ < 4000) {
        if (n.nodeType === 1) { push(n.getBoundingClientRect()); continue; }
        rg.selectNodeContents(n);
        var rs = rg.getClientRects();
        for (var j = 0; j < rs.length && out.length < KC_MAX; j++) if (inSight(rs[j])) push(rs[j]);
      }
    } catch (_) {}
    return out;
  }
  /** The pin's left inside a part of a grid that asks for it ([data-comment-pin-in]: a sheet's cells, where a pin
   *  beside the cell is on its neighbour: V6e, B3's pin over C3): after its words, else before them (a number set
   *  right), else at its right end; an empty part's in its middle. */
  function pinIn(r, line) {
    var s = Math.max(PIN_MIN, Math.min(PIN, Math.floor(r.height) - 4)); // plugin.js pinSize: never taller than the part
    var lo = r.left + 2, hi = r.right - 2 - s;
    if (!line) return Math.max(lo, r.left + (r.width - s) / 2);
    if (line.right + PIN_GAP <= hi) return line.right + PIN_GAP;
    if (line.left - PIN_GAP - s >= lo) return line.left - PIN_GAP - s;
    return Math.max(lo, hi);
  }
  /** The words the comment's box keeps off where there is room, besides the page's controls (kw: never a reason to
   *  hide the pin): in a part of the page that asks for it ([data-comment-keep-words]: a deck's slide, V6d's box
   *  over the eyebrow line of the title picked), each text's own extent, [left, top, right, bottom] in the window,
   *  those in sight and not el's own (all of them where el is that part: its blank picked), at most KEEP_MAX. */
  function keptWords(el) {
    var wk = el.closest && el.closest("[data-comment-keep-words]"), out = [];
    if (!wk) return out;
    try {
      var w = document.createTreeWalker(wk, NodeFilter.SHOW_TEXT), n, rg = document.createRange();
      for (var i = 0; (n = w.nextNode()) && i < 400 && out.length < KEEP_MAX; i++) {
        if (!/\S/.test(n.nodeValue) || (el !== wk && el.contains(n)) || (n.parentElement && n.parentElement.closest("[data-hermes-ui]"))) continue;
        rg.selectNodeContents(n);
        var q = rg.getBoundingClientRect();
        if (q.width < 1 || q.height < 1 || q.right <= 0 || q.bottom <= 0 || q.left >= innerWidth || q.top >= innerHeight) continue;
        out.push([Math.floor(q.left), Math.floor(q.top), Math.ceil(q.right), Math.ceil(q.bottom)]);
      }
    } catch (_) {}
    return out;
  }
  /** The page's own controls the comment's box keeps off where there is room ([data-comment-keep]: a film's
   *  playback bar and scenes, a canvas's floating tools, a design's frame names, a deck's thumbnails), each
   *  [left, top, right, bottom] in the window: those in sight, not one holding el, at most KEEP_MAX. */
  var KEEP_MAX = 24;
  function keeps(el) {
    var out = [], ns = document.querySelectorAll("[data-comment-keep]");
    for (var i = 0; i < ns.length && out.length < KEEP_MAX; i++) {
      if (ns[i].contains(el)) continue;
      var q = ns[i].getBoundingClientRect();
      if (q.width < 1 || q.height < 1 || q.right <= 0 || q.bottom <= 0 || q.left >= innerWidth || q.top >= innerHeight) continue;
      out.push([Math.floor(q.left), Math.floor(q.top), Math.ceil(q.right), Math.ceil(q.bottom)]);
    }
    return out;
  }
  // What the host titles a comment with: the part's name where the page gave one (data-comment-label on it or
  // around it: "Note", "Slide 3", "Region filter"), with the clicked words after it; else the words; else ""
  // (the host's neutral "Selected part"), never a tag name. At most LABEL_MAX, cut at a word.
  var LABEL_MAX = 40;
  function clipWords(s, n) {
    s = String(s || "").trim().replace(/\s+/g, " ");
    if (s.length <= n) return s;
    var c = s.slice(0, n - 1), i = c.lastIndexOf(" ");
    return (i > n * 0.4 ? c.slice(0, i) : c).replace(/[\s,;:.\u00b7\u2013-]+$/, "") + "\u2026";
  }
  function wordsOf(el) {
    if (el.tagName === "SELECT") { var o = el.selectedOptions && el.selectedOptions[0]; return o ? o.text : ""; }
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) return "";
    return el.innerText || el.textContent || el.getAttribute("alt") || el.getAttribute("aria-label") || "";
  }
  function pickLabel(el) {
    var named = el.closest("[data-comment-label]");
    if (!named) return clipWords(wordsOf(el), LABEL_MAX);
    // In a named part, only words the clicked element holds itself (a value, a heading) follow the name: a click
    // on the part's padding or a box around its words is the part.
    var direct = !el.children.length || /^(SELECT|INPUT|TEXTAREA)$/.test(el.tagName) ||
      Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && /\S/.test(n.nodeValue); });
    var name = named.getAttribute("data-comment-label") || "", own = named !== el && direct ? clipWords(wordsOf(el), LABEL_MAX) : "";
    return clipWords(!own || own.toLowerCase() === name.toLowerCase() ? name : name + " \u00b7 " + own, LABEL_MAX); // a label shown in capitals is the name
  }
  function onPick(e) {
    if (!picking) return;
    e.preventDefault(); e.stopImmediatePropagation();
    var el = e.target;
    if (blank(el, e.clientX, e.clientY)) return;
    var text = wordsOf(el).trim().replace(/\s+/g, " ");
    emit("picked", { selector: selectorOf(el), text: text.slice(0, 200), label: pickLabel(el), rect: pickRect(el) });
    follow({ el: el });
  }
  // The element picked last, while its new comment is open: when the page scrolls or the frame is resized its
  // new rect goes to the host (at most every PICKED_GAP_MS), so the comment's pin and form stay at it. The host
  // says when the comment closes (pick-follow off); the next pick mode forgets it too. Listening only meanwhile.
  // picked: {el} (the bridge's own pick), or {el, box} where box() measures a page's own part again (null: gone).
  var PICKED_GAP_MS = 40;
  var picked = null, pickedTimer = 0, pickedAt = 0;
  function pickedMoved() {
    if (!picked || pickedTimer) return;
    pickedTimer = setTimeout(function () {
      pickedTimer = 0;
      if (!picked || !picked.el.isConnected) return;
      pickedAt = Date.now();
      var b = picked.box ? picked.box() : null;
      if (picked.box && !b) return;
      emit("picked-rect", { rect: b ? boxRect(picked.el, b) : pickRect(picked.el) });
    }, Math.max(0, PICKED_GAP_MS - (Date.now() - pickedAt)));
  }
  function follow(p) {
    if (!picked) { window.addEventListener("scroll", pickedMoved, true); window.addEventListener("resize", pickedMoved); }
    picked = p;
  }
  function unfollow() {
    if (!picked) return;
    picked = null;
    if (pickedTimer) { clearTimeout(pickedTimer); pickedTimer = 0; }
    window.removeEventListener("scroll", pickedMoved, true); window.removeEventListener("resize", pickedMoved);
  }
  on("pick-follow", function (d) { if (!(d && d.on)) unfollow(); });
  // While picking, a crosshair over all of the page (its own cursors, a link's hand or a text's caret, would say
  // a click does what it always does there); gone with pick mode.
  var pickStyle = null;
  function setPicking(on) {
    picking = !!on;
    if (picking) unfollow();
    document.documentElement.style.cursor = picking ? "crosshair" : "";
    if (picking) document.documentElement.setAttribute("data-commenting", "1"); else document.documentElement.removeAttribute("data-commenting");
    if (picking && !pickStyle) {
      pickStyle = document.createElement("style");
      pickStyle.setAttribute("data-hermes-ui", "");
      // A frame of the page's (a design system's preview, an embed) is a document of its own: a click in it would
      // never reach this pick. While picking it takes no pointer: the click picks what holds it. A frame whose page
      // picks inside it itself (a design's artboards: data-comment-frame) keeps it.
      pickStyle.textContent = "html[data-commenting] *{cursor:crosshair!important}" +
        "html[data-commenting] iframe:not([data-comment-frame]){pointer-events:none!important}";
      document.documentElement.appendChild(pickStyle);
    }
    if (!picking && pickStyle) { pickStyle.remove(); pickStyle = null; }
    if (!picking && hoverBox) { hoverBox.remove(); hoverBox = null; }
  }
  // Esc while picking ends it (the host's band says so): the page's own Esc handlers never see that press.
  window.addEventListener("keydown", function (e) {
    if (!picking || e.key !== "Escape") return;
    e.preventDefault(); e.stopImmediatePropagation();
    setPicking(false);
    emit("pick-cancel", {});
  }, true);
  // While picking, the press that makes the click reaches none of the page's own handlers: it would focus an
  // editor, place a caret, start a drag or a selection (a pick is a look, never an edit). The click itself
  // still comes (onPick; a page that picks on its own, like motion, takes it on window first). A finger's tap
  // is a pointerdown too (its default kept from the page: no mouse events, no focus after it); its touch events
  // only stay from the page's handlers: cancelling them would cancel the tap's click, the pick itself.
  function swallow(e) {
    if (!picking) return;
    var t = e.target;
    if (t && t.closest && t.closest("[data-hermes-ui]")) return;
    if (e.cancelable && e.type.slice(0, 5) !== "touch") e.preventDefault();
    e.stopImmediatePropagation();
  }
  ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu", "dragstart", "selectstart"]
    .forEach(function (t) { window.addEventListener(t, swallow, { capture: true, passive: false }); });
  ["touchstart", "touchend"].forEach(function (t) { window.addEventListener(t, swallow, { capture: true, passive: true }); });
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onPick, true);
  // Picking on: the host is told when a click picks (it holds one made sooner: V6e, a pick 0 ms after Comment in a
  // page just opened was lost), at once, or by a page that picks inside frames of its own once they all do
  // (<html data-pick-later>: a design's artboards; hermes.pickReady). The click it held comes back as pick-at.
  // Never before the page's first real render (its "ready": V6f, a sheet said so as its port came, before its grid
  // was laid out, and the click held for it, or one made then, hit nothing).
  var framesPick = false; // a data-pick-later page said its frames pick (hermes.pickReady), this pick mode
  function sayPickReady() {
    if (!picking || !rd.msg || (document.documentElement.hasAttribute("data-pick-later") && !framesPick)) return;
    emit("pick-ready", {});
  }
  on("comment-mode", function (d) {
    setPicking(d && d.on);
    framesPick = false;
    sayPickReady();
  });
  on("pick-at", function (d) {
    if (!picking || !d || !isFinite(d.x) || !isFinite(d.y)) return;
    var el = document.elementFromPoint(d.x, d.y);
    if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: d.x, clientY: d.y }));
  });
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
  /** The flashed box kept off the page's own comment marks (the children of a [data-flash-keep]: a doc's margin
   *  icons beside its blocks): its side towards a mark it would cover, or come within 4 px of (its 3 px halo
   *  counted), moves back, so the mark stays seen while its element flashes. */
  var KEEP_GAP = 4, HALO = 3, EDGE = 2;
  function keepClear(b, el) {
    var keep = document.querySelectorAll("[data-flash-keep] > *");
    if (!keep.length) return;
    // where place2 put it (its own rect may be mid-transition): el's box and the 2 px border round it
    var e = el.getBoundingClientRect(), r = { left: e.left - EDGE, right: e.right + EDGE, top: e.top - EDGE, bottom: e.bottom + EDGE };
    var l = r.left, rt = r.right, pad = KEEP_GAP + HALO;
    for (var i = 0; i < keep.length; i++) {
      var q = keep[i].getBoundingClientRect();
      if (!q.width || !q.height || q.top >= r.bottom + pad || q.bottom <= r.top - pad || q.left >= rt + pad || q.right <= l - pad) continue;
      if (q.left + q.width / 2 >= (l + rt) / 2) rt = Math.min(rt, q.left - pad); else l = Math.max(l, q.right + pad);
    }
    if (rt - l < 2 * EDGE + 8 || (l === r.left && rt === r.right)) return;
    b.style.left = l + "px"; b.style.width = rt - l - 2 * EDGE + "px";
  }
  on("flash", function (d) {
    var el; try { el = document.querySelector(d && d.selector); } catch (_) {}
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    var b = box(mark()); place2(b, el); keepClear(b, el);
    setTimeout(function () { place2(b, el); keepClear(b, el); }, 350);
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
    /** Start a comment on a part of the page (the host opens its comment form there). where (optional): the
     *  element it is on, or {el, box} for a part the page measures itself (box: {x, y, w, h} in the window, or a
     *  function giving it again after a scroll or a resize; boxRect says what more it may carry): the host then
     *  opens the form beside it with its pin, as for a pick, and not in its panel. */
    comment: function (anchor, where) {
      var a = Object.assign({}, anchor || {}), el = where && (where.nodeType === 1 ? where : where.el);
      if (el && el.nodeType === 1) {
        var given = where.nodeType === 1 ? null : where.box;
        var box = given == null ? null : typeof given === "function" ? given : function () { return given; };
        var b = box ? box() : null;
        if (!box || b) {
          a.rect = b ? boxRect(el, b) : pickRect(el);
          follow(box ? { el: el, box: box } : { el: el });
        }
      }
      emit("comment", a);
    },
    /** A page that moved what was commented on without a scroll (a canvas panned or zoomed): its pin follows. */
    moved: function () { pickedMoved(); },
    /** A page that picks inside frames of its own (<html data-pick-later>): its clicks pick from now on. */
    pickReady: function () { if (picking) { framesPick = true; sayPickReady(); } },
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
    /** Type runtimes: a short note to the person, shown by the host as its own toast (kind: info, success,
     *  error). Resolves {ok: true} when the host showed it; a host without the op rejects (the page shows its own). */
    notify: function (message, kind, ms) {
      return call("notify", { message: String(message == null ? "" : message).slice(0, 300),
        kind: kind === "error" || kind === "success" ? kind : "info", ms: typeof ms === "number" && ms > 0 ? Math.min(ms, 15000) : null });
    },
    /** Type runtimes: where the user is in the page (sent along with their next chat message). */
    view: function (context) { return call("view", { context: context || {} }); },
    /** Live types: the parts the user is typing in now (a doc's block ids, "<sheet>!A1", a board's item ids),
     *  words not saved yet; Hermes' edit of them is refused until the save (a few seconds). */
    typing: function (keys) { return call("typing", { keys: (keys || []).slice(0, 20).map(String) }); },
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
