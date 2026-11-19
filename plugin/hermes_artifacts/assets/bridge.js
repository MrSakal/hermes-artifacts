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
  // page styles none of its own; and its keyboard focus as Hermes shows it (the accent's 3 px ring, not the
  // browser's own outline: V6l, Tab on a free-form page's button). One <style> put first into <head> by the DOM (no
  // line of the document moves), every selector in :where() (specificity 0, first in order): any rule of the page
  // wins. Not in an export (no bridge there), not in a type runtime (the kit styles its own).
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
      var thumb = barColour(hostBars.muted) || barColour(hostBars.strong), track = barColour(hostBars.bg), ring = barColour(hostBars.accent);
      var bars = !!thumb && !ownScrollbars();
      if (document.getElementById("hermes-artifact-content") || !(bars || ring)) { if (mine) mine.remove(); return; }
      var css = (bars ? ":where(*){scrollbar-width:thin;scrollbar-color:" + thumb + " transparent}" +
        (track ? ":where(:root){scrollbar-color:" + thumb + " " + track + "}" : "") : "") +
        // a ring as Hermes' (box-shadow, 3 px; V6m: an outline is drawn in whole device px, 2.4 px at 125 %)
        (ring ? ":where(:focus-visible){outline:none;box-shadow:0 0 0 3px color-mix(in srgb," + ring + " 50%,transparent)}" : "");
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
  // Two frames, or NO_PAINT_MS where none comes: a page the host keeps out of sight while it loads (under its
  // "Loading", Desktop's frame of its own process) is often given no frames until it is shown, so waiting longer
  // only kept it hidden (V6w: a film's ready 1 s after its page had drawn, "Loading" 1.5 s after each remount).
  var NO_PAINT_MS = 150;
  function afterPaint(fn) {
    var done = false, go = function () { if (!done) { done = true; fn(); } };
    try { requestAnimationFrame(function () { requestAnimationFrame(go); }); } catch (_) {}
    setTimeout(go, NO_PAINT_MS);
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
  var picking = false, hoverBox = null, hoverAt = null, pins = [];
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
  function place2(b, el) { // round el; one of no size round what is drawn in it (V6w: a connector's 0 x 0 box rang 3 x 3 at the canvas's corner)
    var r = drawnBox(el);
    b.style.left = r.left - 2 + "px"; b.style.top = r.top - 2 + "px";
    b.style.width = r.width + "px"; b.style.height = r.height + "px";
  }
  /** What a click on t picks: t, or the part drawn as one that holds it ([data-comment-whole]: a board's sticky or
   *  shape, whose words inside are not a part of their own: V6h, the box 5 px off the pill drawn round "Ship"). */
  // A click on the words or icon inside one of the page's controls picks the control (V6i B3: a design system's
  // nav item picked as its label span, the box 4.8 px off the button holding it and the pin dropped on its neighbour).
  function wholeOf(t, x, y) {
    if (!t || !t.closest) return t;
    var n = nearestPart(t, x, y);
    if (n) return n;
    var w = t.closest("[data-comment-whole]");
    if (w) return w;
    var c = t.closest(CONTROL);
    return c && c !== t && !c.hasAttribute("contenteditable") ? c : t;
  }
  /** A press on none of the parts of a page that names them ([data-comment-nearest]="<selector>": a doc's blocks),
   *  in it or round it (between two blocks, in its margins, under the last): the nearest of them with something in
   *  it, by the line pressed first (V6j: a press between a doc's blocks picked nothing, or a point after 3 s); an
   *  empty one only where all are. Not one on another of the page's controls or words. null otherwise. */
  function nearestPart(t, x, y) {
    var area = document.querySelector("[data-comment-nearest]");
    if (!area || !isFinite(x) || !isFinite(y)) return null;
    var sel = area.getAttribute("data-comment-nearest");
    try { if (t.closest(sel) || !(area.contains(t) || t.contains(area)) || t.closest(CONTROL + ", [data-comment-keep], [data-hermes-ui]")) return null; } catch (_) { return null; }
    for (var i = 0; i < t.childNodes.length; i++) { var c = t.childNodes[i]; if (c.nodeType === 3 && /\S/.test(c.nodeValue)) return null; }
    // one with something in it first (V6l: a press under a doc's last block picked the empty checklist item there)
    var best = null, all = area.querySelectorAll(sel);
    for (i = 0; i < all.length; i++) {
      var q = all[i].getBoundingClientRect();
      if (q.width < 1 || q.height < 1 || all[i].parentElement.closest(sel)) continue;
      var dy = Math.max(0, q.top - y, y - q.bottom), dx = Math.max(0, q.left - x, x - q.right);
      var bare = !all[i].textContent.trim() && !all[i].querySelector("img, svg, canvas, video, table, hr, select, [data-md], input:not([type=checkbox])") ? 1 : 0;
      if (!best || bare < best.bare || (bare === best.bare && (dy < best.dy || (dy === best.dy && dx < best.dx)))) best = { el: all[i], dy: dy, dx: dx, bare: bare };
    }
    return best && best.el;
  }
  function onMove(e) {
    if (!picking) return;
    var el = wholeOf(e.target, e.clientX, e.clientY);
    if (!el || el.hasAttribute("data-hermes-ui")) return;
    hoverBox = hoverBox || box(mark());
    // A part the page draws itself (hermes.hover: a model's), round its box; what a click there would pick: nothing
    // on the page's blank (no box), else the element.
    var at = null;
    if (hoverAt) try { at = hoverAt(e.clientX, e.clientY); } catch (_) {}
    hoverBox.style.display = at || !blank(el, e.clientX, e.clientY) ? "" : "none";
    if (at) { hoverBox.style.left = at.x - 2 + "px"; hoverBox.style.top = at.y - 2 + "px"; hoverBox.style.width = at.w + "px"; hoverBox.style.height = at.h + "px"; }
    else place2(hoverBox, el);
  }
  /** A click on none of the page's own content: the document itself, or a big box that holds blocks (the page,
   *  its column) where none of them is, with no words of its own (the blank under a doc's last block, the gap
   *  between a dashboard's tiles). Picks nothing: pick mode stays on. */
  function blank(el, x, y) {
    if (!el || el === document.body || el === document.documentElement || off(el)) return true;
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
  /** Only what was made is commented on, never the type's own chrome: its bars, palettes and panels
   *  ([data-comment-keep]) and the ground its parts lie on ([data-comment-off]: a board's canvas, a sheet's headers).
   *  A press there outside a part (named, drawn as one, or [data-comment-on]: a sheet's tab) picks nothing and shows
   *  no box. */
  function off(el) {
    return !!(el.closest && el.closest("[data-comment-off], [data-comment-keep]") && !el.closest("[data-comment-whole], [data-comment-label], [data-comment-on]"));
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
  /** Whether a pin at box {l, t, r, b} would cover anything of another element: its words, a picture or control,
   *  or a part drawn as one ([data-comment-whole]: a board's shape, V6m: a connector's pin on the node it points
   *  at; not one the page lets a pin lie on, [data-comment-under]: a board's section). The element itself, what
   *  holds it (the column, the body) and the plugin's own marks don't count. */
  function blocked(el, box) {
    var pts = [[(box.l + box.r) / 2, (box.t + box.b) / 2], [box.l + 1, box.t + 1], [box.r - 1, box.t + 1], [box.l + 1, box.b - 1], [box.r - 1, box.b - 1]];
    var seen = [], wholes = document.querySelectorAll("[data-comment-whole]:not([data-comment-under])");
    // a part drawn as one within PIN_EDGE of it, by its box (a rounded shape's corner is no hit, V6m: the pin flush on Ship)
    for (var w = 0; w < wholes.length && w < 2000; w++) {
      var n = wholes[w];
      if (n === el || n.contains(el) || el.contains(n) || n.closest("[data-hermes-ui]")) continue;
      var q = n.getBoundingClientRect();
      if (q.width > 0 && q.height > 0 && q.left < box.r + PIN_EDGE && box.l - PIN_EDGE < q.right && q.top < box.b + PIN_EDGE && box.t - PIN_EDGE < q.bottom) return true;
    }
    for (var p = 0; p < pts.length; p++) {
      var hits = document.elementsFromPoint ? document.elementsFromPoint(pts[p][0], pts[p][1]) : [];
      for (var k = 0; k < hits.length; k++) {
        var h = hits[k];
        if (seen.indexOf(h) >= 0 || h === el || h.contains(el) || el.contains(h) || h.closest("[data-hermes-ui]")) continue;
        seen.push(h);
        var whole = h.closest("[data-comment-whole]");
        if (whole && (whole === el || whole.contains(el) || el.contains(whole) || whole.hasAttribute("data-comment-under"))) whole = null;
        if (SOLID.test(h.tagName) || whole || ownWords(h, box)) return true;
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
  function pickRect(el) {
    // its words while any of them is in sight; else the part's box (V6n: a heading wider than the window scrolled
    // sideways, its words out of sight and the rest of it seen, had its draft hidden as out of sight)
    var w = wordsRect(el), bd = w && band(el);
    if (w && (w.right <= 0 || w.left >= innerWidth || w.bottom <= bd.t || w.top >= bd.b)) w = null;
    return rectOf(el, w || inkRect(el), firstLine(el), null);
  }
  /** A heading's or paragraph's words, where it holds only words: what is seen of it (V6j: an h1 full width, its
   *  text short: the room beside its words counted as the part's, the box 156 px off). null otherwise. */
  function wordsRect(el) {
    if (!/^(H[1-6]|P)$/.test(el.tagName) || el.querySelector("img, svg, canvas, video, iframe, input, select, textarea, button")) return null;
    var rg = document.createRange(), q;
    try { rg.selectNodeContents(el); q = rg.getBoundingClientRect(); } catch (_) { return null; }
    return q && q.width >= 1 && q.height >= 1 ? q : null;
  }
  /** el's box as drawn: its own, and the strokes of the shapes drawn in it (an SVG's outline reaches half its
   *  width past the shape's box), so what keeps off it keeps off what is seen. */
  function inkRect(el) {
    // A box of no size (a board's connector: its lines are drawn in it, overflowing) is not a corner of the ink (V6j:
    // its 0 x 0 box at the canvas's origin made the connector's rect 750 x 296 px, the comment's box 57 px off)
    var r = el.getBoundingClientRect(), some = r.width > 0 || r.height > 0;
    var l = some ? r.left : Infinity, t = some ? r.top : Infinity, rt = some ? r.right : -Infinity, b = some ? r.bottom : -Infinity;
    strokes(el).forEach(function (q) { l = Math.min(l, q.l); t = Math.min(t, q.t); rt = Math.max(rt, q.r); b = Math.max(b, q.b); });
    if (!(rt > l)) return r; // no size and no strokes drawn
    return { left: l, top: t, right: rt, bottom: b, width: rt - l, height: b - t };
  }
  /** el's box, or for one of no size (a board's connector) what is drawn in it (inkRect): the hover and flash rings. */
  function drawnBox(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 ? r : inkRect(el);
  }
  /** The strokes of the shapes drawn in el (el too), each {l, t, r, b} in the window with half its width round it. */
  function strokes(el) {
    var out = [], list = [el].concat(Array.prototype.slice.call(el.querySelectorAll ? el.querySelectorAll("svg *") : [], 0, 200));
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!(typeof SVGGeometryElement !== "undefined" && n instanceof SVGGeometryElement)) continue;
      var cs = getComputedStyle(n), q = n.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility === "hidden" || !cs.stroke || cs.stroke === "none" || /^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.stroke) || !(q.width || q.height)) continue;
      var m = n.getScreenCTM && n.getScreenCTM(), pad = (parseFloat(cs.strokeWidth) || 0) / 2 * (m ? Math.hypot(m.a, m.b) : 1);
      out.push({ l: q.left - pad, t: q.top - pad, r: q.right + pad, b: q.bottom + pad });
    }
    return out;
  }
  /** pickRect for a box {x, y, w, h} in the window that a page measured itself (a part inside an artboard's own
   *  frame, a point of a film's picture), in `el` (what holds it there: the frame, the picture). The page may say
   *  where its first line is (ly, lh, lr, and ll where its words start) and which pin spots are taken inside el (fr, fl, fw, fa, fb: false,
   *  where it alone can see); point: true pins it on the box's middle (a point, not a part), seen when that
   *  point is (a box of no size is never "seen": the pin and the box went to the corner). */
  function boxRect(el, b) {
    var r = b.point ? { left: b.x + b.w / 2 - 0.5, top: b.y + b.h / 2 - 0.5, width: 1, height: 1 } : { left: b.x, top: b.y, width: b.w, height: b.h };
    r.right = r.left + r.width; r.bottom = r.top + r.height;
    var line = isFinite(b.ly) && isFinite(b.lh) && b.lh > 0 ? { top: b.ly, height: b.lh, right: isFinite(b.lr) ? b.lr : r.right, left: isFinite(b.ll) ? b.ll : r.left } : null;
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
      // not on el's own words, nor on its own lines (a board connector's label drawn on its line: V6l, the pin on the
      // line between "yes" and the arrowhead)
      out.fw = free("fw", wb) && (!!given || (!ownWords(el, wb) && !strokes(el).some(function (q) { return q.l < wb.r && wb.l < q.r && q.t < wb.b && wb.t < q.b; }))); // a boolean: the host drops anything else
    }
    // not a part drawn as one over the grid (a sheet's chart: V6k, its pin in its middle over the pie)
    var grid = el.closest && el.closest("[data-comment-pin-in]");
    if (grid && grid !== el && !el.hasAttribute("data-comment-whole")) out.px = pinIn(r, line);
    var kp = keeps(el), kc = contentIn();
    if (kp.length) out.kp = kp;
    if (kc.length) out.kc = kc;
    return out;
  }
  /** What is on the page in sight, for the pin to keep off where a part has no free side (kc): each line of words
   *  and each picture or control, [left, top, right, bottom] in the window, at most KC_MAX (the first in the page's
   *  order); a box out of sight is not looked into, nor one the page lets a pin lie on ([data-comment-under]: a
   *  design's artboards on its canvas). */
  var KC_MAX = 160;
  function contentIn() {
    var out = [], seen = 0;
    var inSight = function (q) { return q.width >= 1 && q.height >= 1 && q.right > 0 && q.bottom > 0 && q.left < innerWidth && q.top < innerHeight; };
    var push = function (q) { out.push([Math.floor(q.left), Math.floor(q.top), Math.ceil(q.right), Math.ceil(q.bottom)]); };
    try {
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
        if (n.nodeType === 3) return /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        if (n.hasAttribute("data-hermes-ui") || n.hasAttribute("data-comment-under") || n.hasAttribute("data-comment-hide") || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) return NodeFilter.FILTER_REJECT;
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
  /** The page's own controls the comment's pin keeps off ([data-comment-keep]: a film's playback bar and scenes, a
   *  canvas's floating tools, a design's frame names, a deck's thumbnails), each [left, top, right, bottom] in the
   *  window: those in sight, not one holding el, at most KEEP_MAX. */
  // One holding el (a design system's nav, an item of it picked): its other controls each (V6i B3: the pin on a
  // neighbouring nav item).
  var KEEP_MAX = 48, CONTROL = "a[href], button, input, select, textarea, [role=button], [role=tab], [role=link]";
  function keeps(el) {
    var out = [], ns = document.querySelectorAll("[data-comment-keep]");
    var push = function (n) {
      var q = n.getBoundingClientRect();
      if (q.width < 1 || q.height < 1 || q.right <= 0 || q.bottom <= 0 || q.left >= innerWidth || q.top >= innerHeight) return;
      out.push([Math.floor(q.left), Math.floor(q.top), Math.ceil(q.right), Math.ceil(q.bottom)]);
    };
    for (var i = 0; i < ns.length && out.length < KEEP_MAX; i++) {
      if (!ns[i].contains(el)) { push(ns[i]); continue; }
      var cs = ns[i].querySelectorAll(CONTROL);
      for (var j = 0; j < cs.length && out.length < KEEP_MAX; j++) if (!cs[j].contains(el) && !el.contains(cs[j])) push(cs[j]);
    }
    // Every other control of the page in sight, marked or not, the nearest el first (V6i B2: a free-form page's
    // Reset under the pin of "+1"): a button, a field, a link, a checkbox, anything focusable; not one the page hides
    // while picking, nor a box as big as a quarter of the window (a canvas, a grid).
    var e = el.getBoundingClientRect(), more = [];
    var all = document.querySelectorAll(FOCUSABLE);
    for (var k = 0; k < all.length && k < 2000; k++) {
      var n = all[k];
      // the part's own buttons too (the pin never on them): not el nor one holding it
      if (n.closest(NOT_KEPT) || n.contains(el) || n.hasAttribute("contenteditable")) continue;
      var q = n.getBoundingClientRect();
      if (q.width < 1 || q.height < 1 || q.right <= 0 || q.bottom <= 0 || q.left >= innerWidth || q.top >= innerHeight || q.width * q.height > innerWidth * innerHeight / 4) continue;
      if (getComputedStyle(n).visibility === "hidden") continue; // shown on hover (opacity 0) counts: it comes under the pointer
      more.push({ n: n, d: Math.hypot(Math.max(0, q.left - e.right, e.left - q.right), Math.max(0, q.top - e.bottom, e.top - q.bottom)) });
    }
    more.sort(function (a, b) { return a.d - b.d; });
    for (k = 0; k < more.length && out.length < KEEP_MAX; k++) push(more[k].n);
    return out;
  }
  var NOT_KEPT = "[data-comment-keep],[data-hermes-ui],[data-comment-under],[data-comment-hide]"; // controls kept off another way, or not at all
  var MARK_FREE = "[data-hermes-ui],[data-comment-under],[data-comment-hide]"; // what a numbered mark may lie on
  var FOCUSABLE = CONTROL + ", [role=checkbox], [role=switch], [role=menuitem], [role=option], [role=slider], [role=combobox], summary, [tabindex]:not([tabindex='-1'])";
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
    // a field by its name, not what is typed in it (V6k: "Selected part"): its label, aria-label, placeholder
    if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) return (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.title || "";
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
  // A control of the page's that acts while picking too ([data-comment-use]: a design's artboard Play and Full window,
  // V6s; its view's Play and that menu, its name strip, V6u): its click is its own, picks nothing, and picking stays on.
  function used(t) { return !!(t && t.closest && t.closest("[data-comment-use]")); }
  function onPick(e) {
    if (!picking) return;
    if (used(e.target)) { atNone = true; return; }
    e.preventDefault(); e.stopImmediatePropagation();
    var el = wholeOf(e.target, e.clientX, e.clientY);
    if (blank(el, e.clientX, e.clientY)) { atNone = true; return; }
    var text = wordsOf(el).trim().replace(/\s+/g, " ");
    atDone = true;
    // titled by the words clicked, or a part drawn as one with no name of its own (a design system's bullet) by its own
    var k = follow({ el: el, sel: selectorOf(el) });
    emit("picked", { selector: selectorOf(el), text: text.slice(0, 200), label: pickLabel(el.contains(e.target) && !(el.hasAttribute("data-comment-whole") && !el.hasAttribute("data-comment-label")) ? e.target : el), rect: pickRect(el), k: k });
  }
  // The elements picked for new comments (each kept by its pin while its words are: the host's drafts), and the
  // open threads' marks: wherever they move (a scroll, a resize, a canvas panned or zoomed, a re-layout) the pins
  // go with them. Watched every frame while there is one (only their boxes are read; the host is told of each at
  // most every PICKED_GAP_MS, by its k). An element the page drew again is found again by its selector; one no
  // longer drawn (removed, a slide not shown) is "gone": the host takes its pin away until it is back. The host
  // says when a draft goes (pick-follow off, its k). Each: {el, sel} (a pick), or {el, box} where box() measures a
  // page's own part again (null: gone).
  var PICKED_GAP_MS = 40;
  var followed = [], followK = 0, watchRaf = 0;
  function where(p) {
    if (p.box) {
      var b = p.box();
      if (b && b.el && b.el.nodeType === 1) p.el = b.el; // what holds the part now (a slide's canvas made again)
      return b ? [b.x, b.y, b.w, b.h] : null;
    }
    // an open thread's mark: its part found again as it was found at first (V6w: a dashboard's chart drawn again at a
    // new width, its new svg not taken for the old one by its words, the mark hidden for good)
    if (!p.el.isConnected && p.it) {
      var t = locate(p.it)[p.i];
      if (t && t.nodeType === 1) p.el = t;
    } else if (!p.el.isConnected && p.sel) {
      var did = p.el.getAttribute("data-id"), again = null;
      try { again = (did && window.CSS && CSS.escape ? document.querySelector("[data-id=\"" + CSS.escape(did) + "\"]") : null) || document.querySelector(p.sel); } catch (_) {}
      if (again && same(again, p)) p.el = again;
    }
    if (!p.el.isConnected || !p.el.getClientRects().length) return null;
    var r = p.el.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height];
  }
  /** Whether a drawn-again element is the one followed (p): the same id (a board item's data-id, an id); one with
   *  neither, the same kind, words and named part as when it was picked (p.sig: a design system's page drawn again,
   *  left and come back to), never another slide's title at the same place ("Slide 2", not "Slide 1"). */
  function sigOf(el) {
    var named = el.closest("[data-comment-label]");
    return [el.tagName, el.getAttribute("class"), String(el.textContent).slice(0, 400), named ? named.getAttribute("data-comment-label") : ""].join("\u0001");
  }
  function same(a, p) {
    var id = p.el.getAttribute("data-id") || p.el.id;
    if (id) return a.tagName === p.el.tagName && (a.getAttribute("data-id") || a.id) === id;
    return sigOf(a) === p.sig;
  }
  function keyOf(p) { var w = where(p); return w ? w.map(function (v) { return Math.round(v * 2) / 2; }).join() + "," + innerWidth + "," + innerHeight : "gone"; }
  function watch() {
    watchRaf = 0;
    followed.forEach(function (p) { var k = keyOf(p); if (k !== p.key) { p.key = k; pickedMoved(p); } });
    placePins();
    if (followed.length || pins.length) watchRaf = requestAnimationFrame(watch);
  }
  function watchOn() { if (!watchRaf) watchRaf = requestAnimationFrame(watch); }
  function pickedMoved(p) {
    if (p.timer) return;
    p.timer = setTimeout(function () {
      p.timer = 0;
      if (followed.indexOf(p) < 0) return;
      p.at = Date.now();
      var w = where(p);
      if (!w) { emit("picked-rect", { gone: true, k: p.k }); return; }
      emit("picked-rect", { rect: p.box ? boxRect(p.el, p.box()) : pickRect(p.el), k: p.k });
    }, Math.max(0, PICKED_GAP_MS - (Date.now() - (p.at || 0))));
  }
  /** Follows p from now on; its k for the host. */
  function follow(p) {
    p.k = ++followK;
    p.sig = sigOf(p.el);
    p.key = keyOf(p);
    followed.push(p);
    watchOn();
    document.documentElement.setAttribute("data-comment-draft", ""); // its comment is being written (hideStyle)
    return p.k;
  }
  on("pick-follow", function (d) {
    if (d && d.on) return;
    followed = followed.filter(function (p) { if (p.k !== (d && d.k)) return true; clearTimeout(p.timer); return false; });
    if (!followed.length) document.documentElement.removeAttribute("data-comment-draft");
  });
  // While picking, a crosshair over all of the page (its own cursors, a link's hand or a text's caret, would say
  // a click does what it always does there); gone with pick mode.
  var pickStyle = null, hideStyle = null;
  function setPicking(on) {
    picking = !!on;
    if (!picking) heldPick = null;
    document.documentElement.style.cursor = picking ? "crosshair" : "";
    if (picking) document.documentElement.setAttribute("data-commenting", "1"); else document.documentElement.removeAttribute("data-commenting");
    // A page's hover-only affordances ([data-comment-hide]: a doc's block handles) are not shown while a part is
    // picked or its new comment written: nothing to use then, and they came out beside the box (V6g).
    if (picking && !hideStyle) {
      hideStyle = document.createElement("style");
      hideStyle.setAttribute("data-hermes-ui", "");
      hideStyle.textContent = "html[data-commenting] [data-comment-hide],html[data-comment-draft] [data-comment-hide]{visibility:hidden!important}";
      document.documentElement.appendChild(hideStyle);
    }
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
  // Esc while picking ends it (the host's band says so): the page's own Esc handlers never see that press. One while a
  // menu of a control that acts while picking is open (a design's Play: V6u) closes that menu first, as Esc does.
  window.addEventListener("keydown", function (e) {
    if (!picking || e.key !== "Escape" || document.querySelector("[role=menu][data-comment-use]")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    setPicking(false);
    emit("pick-cancel", {});
  }, true);
  // While the new comment's box is open over the page (the host's "comment-open"), a press in the page only closes
  // it (the host is told: "press-out"), as a press outside a menu: it, its release and its click reach none of the
  // page's handlers. A wheel still scrolls and pans. The page's own frames (an artboard, a preview) take no pointer
  // then: their press is this document's. Before picking's own (swallow): every press says whether it is one.
  var boxOpen = false, outPress = false, openStyle = null;
  function pressOut(e) {
    var t = e.target;
    if (t && t.closest && t.closest("[data-hermes-ui]")) return;
    if (e.type === "pointerdown") {
      outPress = boxOpen;
      if (outPress) emit("press-out", {});
    }
    if (!outPress) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === "click") outPress = false;
  }
  ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "dragstart", "selectstart"]
    .forEach(function (t) { window.addEventListener(t, pressOut, { capture: true, passive: false }); });
  on("comment-open", function (d) {
    boxOpen = !!(d && d.on);
    if (boxOpen && !openStyle) {
      openStyle = document.createElement("style");
      openStyle.setAttribute("data-hermes-ui", "");
      openStyle.textContent = "html[data-comment-open] iframe{pointer-events:none!important}";
      document.documentElement.appendChild(openStyle);
    }
    // its comment no longer written (closed by its pin, gone): the page's hover-only affordances are back (hideStyle)
    ["data-comment-open", "data-comment-draft"].forEach(function (a) { if (boxOpen) document.documentElement.setAttribute(a, ""); else document.documentElement.removeAttribute(a); });
  });
  // While picking, the press that makes the click reaches none of the page's own handlers: it would focus an
  // editor, place a caret, start a drag or a selection (a pick is a look, never an edit). The click itself
  // still comes (onPick; a page that picks on its own, like motion, takes it on window first). A finger's tap
  // is a pointerdown too (its default kept from the page: no mouse events, no focus after it); its touch events
  // only stay from the page's handlers: cancelling them would cancel the tap's click, the pick itself. A control that
  // acts while picking (used) keeps its presses as its clicks: focused by them, so Esc reaches its menu (V6u).
  function swallow(e) {
    if (!picking) return;
    var t = e.target;
    if (t && t.closest && (t.closest("[data-hermes-ui]") || used(t))) return;
    if (e.cancelable && e.type.slice(0, 5) !== "touch") e.preventDefault();
    e.stopImmediatePropagation();
  }
  ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu", "dragstart", "selectstart"]
    .forEach(function (t) { window.addEventListener(t, swallow, { capture: true, passive: false }); });
  ["touchstart", "touchend"].forEach(function (t) { window.addEventListener(t, swallow, { capture: true, passive: true }); });
  // On every page (V6k: a free-form page's Reset too): a control a press focused keeps no ring after Esc (V6h: a
  // design's Properties pill clicked shut, then Esc, rang as if the keyboard had reached it); one the keyboard
  // reached keeps its focus and its ring. As the host's own buttons (plugin.js pointerFocus).
  var pressed = null, pressFocus = null;
  document.addEventListener("pointerdown", function (e) {
    pressed = e.target;
    var a = document.activeElement; // pressed again where it already is: by a press now
    if (a && a !== document.body && a.contains && a.contains(e.target)) pressFocus = a;
  }, true);
  document.addEventListener("focusin", function (e) { pressFocus = pressed && e.target.contains && e.target.contains(pressed) ? e.target : null; pressed = null; }, true);
  document.addEventListener("keydown", function (e) {
    var a = pressFocus;
    if (e.key !== "Escape" || !a || document.activeElement !== a || !a.matches("button, [role=button], [role=tab]")) return;
    setTimeout(function () { if (document.activeElement === a) a.blur(); }, 0);
  }, true);
  // A press in the page takes the keys here too: one whose own press keeps the focus where it is (a toolbar's
  // button, mousedown cancelled) left them with the host, and Esc never reached the menu it opened (V6l: a doc's
  // Fonts, on a doc just opened). Not while picking or a new comment's box is open (their presses stop above).
  document.addEventListener("pointerdown", function () { if (!document.hasFocus()) try { window.focus(); } catch (_) {} }, true);
  // Esc pressed in the host while nothing of its own wants it ("key"): as if pressed here, where the focus is.
  on("key", function (d) {
    if (!d || d.key !== "Escape") return;
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  });
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onPick, true);
  // Picking on: the host is told when a click picks (it holds one made sooner: V6e, a pick 0 ms after Comment in a
  // page just opened was lost), at once, or by a page that picks inside frames of its own once they all do
  // (<html data-pick-later>: a design's artboards; hermes.pickReady). The click it held comes back as pick-at.
  // Never before the page's first real render (its "ready": V6f, a sheet said so as its port came, before its grid
  // was laid out, and the click held for it, or one made then, hit nothing).
  var framesPick = false; // a data-pick-later page said its frames pick (hermes.pickReady), this pick mode
  var heldPick = null; // a click made in the page while picking, before its click picks: {x, y}
  function pickOn() { return picking && !!rd.msg && !(document.documentElement.hasAttribute("data-pick-later") && !framesPick); }
  function sayPickReady() {
    if (!pickOn()) return;
    emit("pick-ready", {});
    if (heldPick) { var q = heldPick; heldPick = null; pickAt(q.x, q.y); }
  }
  function pickAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (el) el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }));
  }
  // A click that reaches the page itself while picking is on but before its click picks (no host cover over it: a
  // touch, a press sent to the frame; V6g, 7 of 12 such clicks in a sheet just opened picked nothing): held, the
  // first one, and picked once the page is ready, as the host's pick-at. First of the page's click listeners.
  window.addEventListener("click", function (e) {
    if (!picking || pickOn() || !e.isTrusted || used(e.target)) return;
    if (e.target && e.target.closest && e.target.closest("[data-hermes-ui]")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!heldPick) heldPick = { x: e.clientX, y: e.clientY };
  }, true);
  on("comment-mode", function (d) {
    setPicking(d && d.on);
    framesPick = false;
    sayPickReady();
  });
  // The host keeps a held press until a pick comes of it and sends it again (the same n) when none has yet: a
  // press this page already picked is not picked twice. One on none of the page's parts (its chrome, the ground they
  // lie on: onPick's blank) picks nothing, as a click made here: the host is told ("pick-none"), and lets it go.
  var atN = 0, atDone = false, atNone = false;
  on("pick-at", function (d) {
    if (!picking || !d || !isFinite(d.x) || !isFinite(d.y)) return;
    if (d.n && d.n === atN && atDone) return;
    atN = d.n || 0; atDone = false; atNone = false;
    pickAt(d.x, d.y);
    if (atNone && !atDone) { atDone = true; emit("pick-none", { n: atN }); }
  });
  /** An open thread's mark by its element's top right, just past the ring its Show flashes round it (EDGE and HALO:
   *  V6m, the mark on a board item's ring), kept there (watch); hidden while the element is not drawn or is
   *  scrolled out of its view (V6n: a sheet's cell gone under its headers kept its mark on the grid). A mark that would
   *  meet one before it goes beside it (V6s: two of a design's elements, their corners 11 px apart zoomed out, had
   *  their marks one over the other; two threads on one part, side by side). A part cut by the edge of what holds it has
   *  its mark at the top right of what is seen of it, inside the window and under its page's bars (V6s: a sheet's chart
   *  wider than a narrow frame had its mark 360 px past the frame's edge; scrolled under the grid's frozen rows, it
   *  would sit on them).
   */
  var MARK_H = 18, MARK_GAP = 2;
  function placePins() {
    var moved = false;
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      var w = where(p), k = w ? w.join() + "," + innerWidth + "," + innerHeight : "gone";
      if (k === p.key) continue;
      p.key = k; moved = true;
      var seen = w && inSight(p.el, w); // measured only when it moved
      p.at = seen ? [Math.min(w[0] + w[2], seen.r) + window.scrollX + EDGE + HALO + 1, Math.max(w[1] - 9, seen.t) + window.scrollY] : null;
    }
    if (!moved) return;
    // Each inside the window (V6u: the second of two marks kept at a sheet's frame edge went right of the first, out of
    // the frame), in the order of their numbers: one that meets another goes right of it, and under it where the window
    // ends there (V6w: left of it read 4 before 1), so the numbers go up left to right and top to bottom. Not on another
    // of the page's controls (V6u: a free-form page's "+1" had its mark on the corner of the Reset beside it): up off
    // it, by its own height at most, still at the part's top right.
    var placed = [], sx = window.scrollX, sy = window.scrollY, x0 = sx + MARK_GAP;
    pins.slice().sort(function (a, b) { return a.it.n - b.it.n; }).forEach(function (p) {
      p.b.style.display = p.at ? "" : "none";
      if (!p.at) return;
      var bw = p.b.offsetWidth || MARK_H, x1 = sx + innerWidth - bw - MARK_GAP;
      var l0 = Math.max(x0, Math.min(p.at[0], x1)), l = l0, t = Math.max(sy + MARK_GAP, p.at[1]), o;
      while ((o = controlUnder(p.el, l - sx, t - sy, bw))) {
        var up = o.top + sy - MARK_GAP - MARK_H;
        if (up < p.at[1] - MARK_H || up < sy + MARK_GAP) break;
        t = up;
      }
      for (var j = 0; j < placed.length; j++) {
        var q = placed[j];
        if (!(l < q.r + MARK_GAP && q.l < l + bw + MARK_GAP && t < q.b && q.t < t + MARK_H)) continue;
        if (q.r + MARK_GAP <= x1) l = q.r + MARK_GAP;
        else { l = l0; t = q.b + MARK_GAP; }
        j = -1;
      }
      placed.push({ l: l, t: t, r: l + bw, b: t + MARK_H });
      p.b.style.left = l + "px"; p.b.style.top = t + "px";
    });
  }
  /** The box of a control of the page's seen under a mark at x, y (w wide, in the window), or of the words of the type's
   *  own chrome ([data-comment-keep]: a deck's slide number, V6w: slide 1's mark on thumbnail 2's "2"), its controls too
   *  (a deck's thumbnails); not el's own nor one holding it; null when none is. */
  function controlUnder(el, x, y, w) {
    if (!document.elementsFromPoint) return null;
    var pts = [[x + 1, y + 1], [x + w - 1, y + 1], [x + 1, y + MARK_H - 1], [x + w - 1, y + MARK_H - 1], [x + w / 2, y + MARK_H / 2]];
    for (var i = 0; i < pts.length; i++) {
      var hits = document.elementsFromPoint(pts[i][0], pts[i][1]);
      for (var k = 0; k < hits.length; k++) {
        var h = hits[k];
        if (h.closest("[data-hermes-ui]")) continue;
        var c = h.closest(FOCUSABLE);
        if (!c && h.closest("[data-comment-keep]") && Array.prototype.some.call(h.childNodes, function (n) { return n.nodeType === 3 && /\S/.test(n.nodeValue); })) c = h;
        if (c && !c.closest(MARK_FREE) && !c.hasAttribute("contenteditable") && !c.contains(el) && !el.contains(c)) {
          var q = c.getBoundingClientRect();
          if (q.width * q.height <= innerWidth * innerHeight / 4) return q;
        }
        break; // what is seen there
      }
    }
    return null;
  }
  /** Whether any of a box (x, y, w, h in the window) is in sight: inside every box el scrolls or is clipped in, and in
   *  the band its page's own bars leave (band()): the right end and the top of what is seen of it, or null. */
  function inSight(el, w) {
    var l = Math.max(w[0], 0), t = w[1], r = Math.min(w[0] + w[2], innerWidth), b = w[1] + w[3];
    for (var p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      var q = p.getBoundingClientRect();
      l = Math.max(l, q.left); t = Math.max(t, q.top); r = Math.min(r, q.right); b = Math.min(b, q.bottom);
    }
    if (r - l < 1 || b - t < 1) return null;
    var bd = band(el);
    var vt = Math.max(t, bd.t); // its top cut (scrolled under a bar, out of its box): what is seen of it starts there
    return Math.min(b, bd.b) - vt >= 1 ? { r: r, t: vt > w[1] ? vt : -Infinity } : null;
  }
  // A page whose comments name their parts its own way (a sheet's cell:, a model's part:, a deck's whole slide) finds
  // them itself first (hermes.locate): an element, {el, box()} with box() the part's rect in the window (null: not
  // drawn now), or a list of them (a slide: its thumbnail and its frame). Else the selector. It gets the thread too
  // (its label and words: a sheet's chart from before charts had ids).
  var locator = null, pinItems = [], pinTries = 0, pinTimer = 0;
  on("pins", function (items) { pinItems = items || []; pinTries = 0; drawPins(); });
  /** Where a thread's part is now: the page's own finding (locator), else its selector; a list, empty when none. */
  function locate(it) {
    var L = null;
    if (locator) try { L = locator(String(it.selector || ""), it); } catch (_) {}
    if (!L) try { L = document.querySelector(it.selector); } catch (_) {}
    return [].concat(L || []);
  }
  function drawPins() { // [{selector, n}] numbered badges on commented elements, each part with an open thread
    pins.forEach(function (p) { p.b.remove(); }); pins = [];
    clearTimeout(pinTimer);
    var missing = false;
    pinItems.forEach(function (it) {
      var L = locate(it);
      if (!L.length) missing = true;
      L.forEach(function (t, i) {
        var el = t && t.nodeType === 1 ? t : t && typeof t.box === "function" ? (t.el && t.el.nodeType === 1 ? t.el : document.body) : null;
        if (el) badge(it, el, t.nodeType === 1 ? null : t.box, i);
      });
    });
    // a part the page has not drawn yet (a board's items come after the threads): looked for again, for 6 s at most
    if (missing && pinTries++ < 15) pinTimer = setTimeout(drawPins, 400);
    placePins();
    watchOn();
  }
  function badge(it, el, box, i) {
    var b = document.createElement("div");
    b.setAttribute("data-hermes-ui", "");
    b.textContent = String(it.n);
    // its own sizing, not the page's (V6u: a free-form page, content-box, drew it 28 x 18 where a type's is 18 x 18)
    b.style.cssText = "position:absolute;z-index:2147483645;box-sizing:border-box;min-width:18px;height:18px;padding:0 5px;" +
      "border-radius:9px;background:" + mark() + ";color:#fff;font:600 11px/18px system-ui,sans-serif;" +
      "text-align:center;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.3)";
    b.addEventListener("mousedown", function (e) { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); emit("pinOpen", { n: it.n }); });
    document.body.appendChild(b); pins.push({ b: b, el: el, box: box, it: it, i: i, key: "" });
  }
  /** The flashed box kept off the page's own comment marks (the children of a [data-flash-keep]: a doc's margin
   *  icons beside its blocks): its side towards a mark it would cover, or come within 4 px of (its 3 px halo
   *  counted), moves back, so the mark stays seen while its element flashes. */
  var KEEP_GAP = 4, HALO = 3, EDGE = 2;
  function keepClear(b, el) {
    var keep = document.querySelectorAll("[data-flash-keep] > *");
    if (!keep.length) return;
    // where place2 put it (its own rect may be mid-transition): el's box and the 2 px border round it
    var e = drawnBox(el), r = { left: e.left - EDGE, right: e.right + EDGE, top: e.top - EDGE, bottom: e.bottom + EDGE };
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
     *  function giving it again wherever it moves, with the element that holds it now as el when that one was made
     *  again; null while it is not drawn; boxRect says what more it may carry): the host then
     *  opens the form beside it with its pin, as for a pick, and not in its panel. */
    /** The page finds the parts its comments name its own way: fn(selector) -> an element, {el, box()}, or null. */
    locate: function (fn) { locator = typeof fn === "function" ? fn : null; drawPins(); },
    /** A page that draws its parts itself (a model's view): fn(x, y) -> the box {x, y, w, h} in the window of the
     *  part a click there picks, or null; the comment pick's ring goes round it. */
    hover: function (fn) { hoverAt = typeof fn === "function" ? fn : null; },
    comment: function (anchor, where) {
      var a = Object.assign({}, anchor || {}), el = where && (where.nodeType === 1 ? where : where.el);
      if (el && el.nodeType === 1) {
        var given = where.nodeType === 1 ? null : where.box;
        var box = given == null ? null : typeof given === "function" ? given : function () { return given; };
        var b = box ? box() : null;
        if (!box || b) {
          a.rect = b ? boxRect(el, b) : pickRect(el);
          a.k = follow(box ? { el: el, box: box } : { el: el, sel: selectorOf(el) });
        }
      }
      atDone = true;
      emit("comment", a);
    },
    /** A page that moved what was commented on without a scroll (a canvas panned or zoomed): its pin follows. */
    moved: function () { followed.forEach(pickedMoved); },
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
