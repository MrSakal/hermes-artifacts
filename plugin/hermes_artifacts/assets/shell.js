(function () {
  var B = window.__HERMES_BOOT__ || {};
  var frame = document.getElementById("frame");
  if (!frame || !B.id) return;
  var sel = document.getElementById("ver");
  var status = document.getElementById("status");
  var current = B.v;

  // Two frames at a swap: a new version loads out of sight (in the viewport, invisible and inert) while the
  // one on screen stays; it is shown once its page says ready (bridge.js protocol 3), also when it threw (the
  // status line says so). One that threw and drew nothing, or said nothing in time, is not swapped in.
  // The wait (10 s in sight) starts at the frame's hello, or 10 s after it loads without one. A shown page
  // without a beat for 8 s gets the notice; only after 20 s is it reported stalled, and a later beat undoes it.
  var PROTOCOL = 3, CLOSE_GRACE_MS = 2000, WAIT_MS = 10000, WAIT_START_MS = 10000, TICK_MS = 1000, STALL_BAND_MS = 8000, STALL_REPORT_MS = 20000;
  // What a frame out of sight may do at once; the rest waits until it is shown (dropped if it never is).
  var PASS = { "storage.get": 1, "storage.list": 1, "callTool": 1, "report": 1, "vendor": 1, "ds.get": 1, "chrome": 1,
    "history.list": 1, "history.diff": 1, "doc.read": 1, "doc.history": 1, "doc.file": 1, "sheet.read": 1, "sheet.history": 1,
    "sheet.at": 1, "board.read": 1, "board.history": 1, "board.at": 1, "dataset.run": 1, "dataset.call": 1, "dataset.history": 1 };
  var stage = document.createElement("div");
  stage.className = "stage";
  frame.parentNode.insertBefore(stage, frame);
  stage.appendChild(frame);
  function rec(el, v) { return { el: el, v: v, port: null, hello: 0, ready: null, outcome: null, pre: 0, waited: 0, beat: Date.now(), stalled: false, queue: [], dead: false }; }
  var shown = rec(frame, current), pending = null, notice = null, lastTick = null;
  shown.wasShown = true; // the first frame is on screen from the start

  function src(v) { return B.content + "/c/" + encodeURIComponent(B.id) + "/v" + v + "/index.html"; }
  function flash(t) { if (notice) return; status.textContent = t; clearTimeout(flash.t); flash.t = setTimeout(function () { if (!notice) status.textContent = ""; }, 2500); }
  /** A lasting line in the status (a version that did not load, a page that stopped answering), with one action. */
  function say(text, label, fn) {
    notice = text ? { text: text } : null;
    clearTimeout(flash.t);
    status.textContent = text || "";
    if (text && label) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = label; b.className = "act";
      b.addEventListener("click", fn);
      status.appendChild(document.createTextNode(" "));
      status.appendChild(b);
    }
  }
  function post(kind, r, body) { // the shell's own report (never the page's): the version this shell loaded
    if (post.off) return;
    body.version = r.v;
    try {
      fetch("/host/" + encodeURIComponent(B.id) + "/" + kind, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Hermes-Token": B.token }, body: JSON.stringify(body)
      }).then(function (x) { return x.json(); }).then(function (j) { if (j && j.off === true) post.off = true; }).catch(function () {});
    } catch (_) {}
  }
  function outcome(r, o, blank) { if (r.outcome !== o) { r.outcome = o; post("shown", r, blank ? { outcome: o, blank: true } : { outcome: o }); } }
  function drop(r) { // off screen at once; a frame that was shown keeps its port 2 s for its page's last words
    if (!r || r.dead) return;
    r.dead = true; r.queue.length = 0;
    r.el.remove();
    if (pending === r) pending = null;
    var close = function () { r.grace = false; try { r.port && r.port.close(); } catch (_) {} r.port = null; };
    if (r.wasShown && r.port) { r.grace = true; setTimeout(close, CLOSE_GRACE_MS); } else close();
  }
  function reveal(r) {
    if (r.dead) return;
    if (shown && shown !== r) drop(shown);
    pending = null; shown = r; r.wasShown = true; r.beat = Date.now();
    r.el.className = ""; r.el.removeAttribute("aria-hidden"); r.el.inert = false;
    var q = r.queue.splice(0);
    q.forEach(function (fn) { try { fn(); } catch (_) {} });
  }
  function fail(r, why) {
    var text = "v" + r.v + (why === "blank" ? " showed nothing (an error while starting)" : " didn\u2019t finish loading");
    if (shown && shown !== r) {
      var v = r.v;
      drop(r);
      current = shown.v; sel.value = String(shown.v); // the picker and Reload name what is on screen
      say(text + "; showing v" + shown.v, "Show v" + v, function () { say(""); load(v, true); });
    } else { reveal(r); say(text); }
  }
  // Reload of a hung page: the content frames share one renderer process, which the browser ends by itself
  // about 10.5 s after its last frame went; a frame put back sooner lands in it and stays blank. So: every
  // frame out, a pause, the page again; no hello within 4 s: out again, a shorter or longer pause, 3 tries.
  var PAUSES = [11000, 2000, 6000], HELLO_MS = 4000, restarting = null;
  function restart() {
    if (restarting) return;
    restarting = { n: 0 };
    say("Restarting the page\u2026");
    var tries = function () {
      if (pending) drop(pending);
      if (shown) { drop(shown); shown = null; }
      if (restarting.n >= PAUSES.length) {
        restarting = null;
        return say("This page still isn\u2019t responding. Close this tab and open the artifact again in a minute.", "Try again", restart);
      }
      setTimeout(function () {
        load(current, true);
        var r = shown;
        notice = { text: "restarting" }; status.textContent = "Restarting the page\u2026";
        setTimeout(function () {
          if (r.hello) { restarting = null; say(""); } else { restarting.n++; tries(); }
        }, HELLO_MS);
      }, PAUSES[restarting.n]);
    };
    tries();
  }
  function frameEl() {
    var f = document.createElement("iframe");
    ["title", "sandbox", "allow"].forEach(function (a) { if (frame.hasAttribute(a)) f.setAttribute(a, frame.getAttribute(a)); });
    return f;
  }
  /** Show version v: out of sight first (now: at once, e.g. Reload). */
  function load(v, now) {
    current = v; sel.value = String(v);
    say("");
    if (pending) drop(pending);
    var r = rec(frameEl(), v);
    if (now || !shown) { stage.appendChild(r.el); reveal(r); }
    else {
      r.el.className = "pending"; r.el.setAttribute("aria-hidden", "true"); r.el.inert = true;
      stage.appendChild(r.el); pending = r;
    }
    r.el.src = src(v) + "#t=" + Date.now();
  }
  function onEvent(r, ev, d) {
    if (ev === "alive") {
      r.beat = Date.now();
      if (r.stalled) {
        r.stalled = false;
        if (shown === r) say("");
        if (r.stallSent) { r.stallSent = false; if (r.outcome === "ready" || r.outcome === "threw") post("shown", r, { outcome: r.outcome, recovered: true }); } // only busy
      }
    } else if (ev === "diag") {
      var x = d && typeof d === "object" ? d : {};
      var entries = Array.isArray(x.entries) ? x.entries.slice(0, 20) : [];
      post("diag", r, { entries: entries, dropped: +x.dropped > 0 ? +x.dropped : 0 });
    } else if (ev === "ready" && !r.ready) {
      var threw = !!(d && d.threw === true), blank = threw && !!(d && d.blank === true); // no blank: drew something
      r.ready = { threw: threw, blank: blank };
      outcome(r, threw ? "threw" : "ready", blank);
      if (pending === r && blank) return fail(r, "blank");
      if (pending === r) reveal(r);
      if (shown === r && threw) say("v" + r.v + (blank ? " showed nothing (an error while starting)" : " had an error while starting"));
    }
  }

  // Bridge: artifact says hello -> hand it a fresh MessagePort, proxy ops to /api; events stay here.
  window.addEventListener("message", function (e) {
    var r = shown && e.source === shown.el.contentWindow ? shown : pending && e.source === pending.el.contentWindow ? pending : null;
    if (!r) return;
    var d = e.data;
    if (!d || d.__hermes_bridge !== 1 || d.kind !== "hello") return;
    r.hello = typeof d.v === "number" ? d.v : 0;
    if (r.hello < PROTOCOL && pending === r) reveal(r); // an older bridge sends no ready: shown at once
    var ch = new MessageChannel();
    r.port = ch.port1; r.beat = Date.now();
    function handle(m) {
      if (m.op === "download") { // saved here: the server has no such op, and a Blob does not survive JSON
        try {
          var a0 = m.args || {}, c = a0.content;
          var raw = c instanceof Blob || c instanceof ArrayBuffer || ArrayBuffer.isView(c) || typeof c === "string";
          var blob = c instanceof Blob && c.type ? c : new Blob([raw ? c : JSON.stringify(c)], { type: a0.type || "application/octet-stream" });
          var url = URL.createObjectURL(blob), link = document.createElement("a");
          link.href = url; link.download = String(a0.name || "download").replace(/[\\/:*?"<>|]+/g, "_");
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          ch.port1.postMessage({ id: m.id, ok: true, value: { ok: true } });
        } catch (err) { ch.port1.postMessage({ id: m.id, ok: false, error: String(err) }); }
        return;
      }
      fetch("/api/" + encodeURIComponent(B.id) + "/" + encodeURIComponent(m.op), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes-Token": B.token },
        body: JSON.stringify(m.args || {})
      }).then(function (x) {
        return x.json().then(function (j) { return { ok: x.ok, j: j }; });
      }).then(function (x) {
        ch.port1.postMessage(x.ok ? { id: m.id, ok: true, value: x.j } : { id: m.id, ok: false, error: x.j.error });
        if (x.ok && m.op === "send") flash(x.j.delivered ? "Sent to Hermes" : "Saved to the inbox");
      }).catch(function (err) {
        ch.port1.postMessage({ id: m.id, ok: false, error: String(err) });
      });
    }
    ch.port1.onmessage = function (ev) {
      var m = ev.data || {};
      if (r.dead && !r.grace) return;
      if (m.event) return r.dead ? (m.event === "diag" && onEvent(r, m.event, m.detail)) : onEvent(r, m.event, m.detail); // never to /api
      if (r.dead) return m.op === "download" || m.op === "send" ? undefined : handle(m); // a shown frame going: its last edits
      if (r !== shown && !PASS[m.op]) return r.queue.push(function () { handle(m); });
      handle(m);
    };
    // Opaque (sandboxed) origin: targetOrigin must be "*"; the port is bound to this frame only.
    r.el.contentWindow.postMessage({ __hermes_bridge: 1, kind: "port", v: PROTOCOL }, "*", [ch.port2]);
  });

  // The wait for ready and the heartbeat, on this shell's own clock: a late tick (a sleeping or throttled
  // tab) and a hidden tab accuse no page.
  setInterval(function () {
    var t = Date.now(), late = lastTick !== null && t - lastTick > 2 * TICK_MS, step = lastTick === null || late ? TICK_MS : t - lastTick;
    lastTick = t;
    if (!inSight()) { if (shown) shown.beat = t; return; }
    [shown, pending].forEach(function (r) {
      if (!r || r.ready || r.outcome || (r.hello && r.hello < PROTOCOL)) return;
      if (!r.hello && r.pre < WAIT_START_MS) { r.pre += step; return; }
      r.waited += step;
      if (r.waited < WAIT_MS) return;
      outcome(r, "timeout");
      if (pending === r) fail(r, "timeout");
      else say("v" + r.v + " didn\u2019t finish loading");
    });
    var s = shown;
    if (!s || !s.port || s.hello < PROTOCOL) return;
    if (late) { s.beat = t; return; }
    var gap = t - s.beat;
    if (!s.stalled && gap > STALL_BAND_MS) {
      s.stalled = true;
      say("This page stopped responding", "Reload", restart);
    }
    if (s.stalled && !s.stallSent && gap >= STALL_REPORT_MS) { s.stallSent = true; post("shown", s, { outcome: "stalled" }); }
  }, TICK_MS);
  function inSight() { // the tab in front and the frames' stage not hidden by CSS
    if (document.hidden) return false;
    try { if (typeof stage.checkVisibility === "function") return stage.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }); } catch (_) {}
    return true;
  }

  sel.addEventListener("change", function () {
    var v = +sel.value;
    history.replaceState(null, "", v === B.latest ? "/a/" + B.id : "/a/" + B.id + "?v=" + v);
    B.pinned = v !== B.latest;
    load(v);
  });
  document.getElementById("reload").addEventListener("click", function () { load(current, true); });

  // Live reload on republish (unless the viewer pinned an older version).
  var es = new EventSource("/events/" + encodeURIComponent(B.id));
  es.addEventListener("version", function (e) {
    var d = JSON.parse(e.data);
    if (d.v <= B.latest) return;
    B.latest = d.v;
    var o = document.createElement("option");
    o.value = d.v; o.textContent = "v" + d.v;
    sel.insertBefore(o, sel.firstChild);
    if (d.title) document.querySelector(".title").textContent = d.title;
    if (!B.pinned) { sel.value = d.v; load(d.v); flash("New version: v" + d.v); }
  });

  shown.el.src = src(current) + "#t=" + Date.now();
})();
