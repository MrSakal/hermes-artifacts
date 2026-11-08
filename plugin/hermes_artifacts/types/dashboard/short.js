/* Visual short engine: dash.short(scenes). The page writes the chapters (.vs-ch), the captions (.vs-caps)
 * and one scene function per chapter drawing; this plays them: chapter marks, Play/Pause/Back/Next/CC,
 * one animation-frame loop driven by time, cross-fades, captions cued by length, idle-hidden controls,
 * reduced motion (each drawing whole at once). Styles live in dashboard.css (.vs …). */
(function () {
  "use strict";
  var ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
  };

  function button(cls, label, html) {
    var b = document.createElement("button");
    b.type = "button"; b.className = cls; b.setAttribute("aria-label", label); b.innerHTML = html;
    return b;
  }

  window.dashShort = function (dash, scenes, opts) {
    opts = opts || {};
    var stage = document.querySelector((opts.root || ".vs") + " .vs-stage");
    if (!stage) return null;
    var chapters = [].slice.call(stage.querySelectorAll(".vs-ch"));
    if (!chapters.length) return null;
    var caps = stage.querySelector(".vs-caps");
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var rate = opts.rate || 15; // caption characters per second
    var capOf = function (ch) { return stage.querySelector('.vs-cap[data-ch="' + ch.id + '"]'); };
    var length = function (ch) { var c = capOf(ch); return (c ? c.textContent.trim().length : 60) / rate + 1; };
    var state = { i: 0, t: Infinity, playing: false, last: 0, raf: 0 };

    // Chapter marks and controls are the engine's: built here, unless the page wrote its own.
    var marks = stage.querySelector(".vs-marks");
    if (!marks) { marks = document.createElement("div"); marks.className = "vs-marks"; stage.prepend(marks); }
    marks.replaceChildren.apply(marks, chapters.map(function (ch, i) {
      var b = button("vs-mark", ch.dataset.label || ("Chapter " + (i + 1)), "<i></i>");
      b.addEventListener("click", function () { go(i); play(); });
      return b;
    }));
    var ctl = stage.querySelector(".vs-ctl");
    if (!ctl) {
      ctl = document.createElement("div"); ctl.className = "vs-ctl";
      var pz = button("vs-pause", "Pause", ICONS.pause); pz.hidden = true;
      var cc = button("vs-cc", "Captions", "CC"); cc.setAttribute("aria-pressed", "true");
      ctl.append(button("vs-play", "Play", ICONS.play), pz, button("vs-back", "Back", ICONS.back),
        button("vs-next", "Next", ICONS.next), cc);
      marks.after(ctl);
    }

    var drawName = function (ch) { var d = ch.querySelector("[data-draw]"); return d && d.dataset.draw; };
    chapters.forEach(function (ch, i) {
      var name = drawName(ch);
      if (name && scenes[name]) dash.draw(name, function (el) { scenes[name](el, i === state.i && !reduce ? state.t : Infinity); });
    });

    function show() {
      chapters.forEach(function (ch, i) { ch.classList.toggle("vs-on", i === state.i); ch.setAttribute("aria-hidden", String(i !== state.i)); });
      var say = chapters[state.i].querySelector(".vs-say");
      if (say && caps) caps.style.top = say.offsetTop + "px";
      stage.querySelectorAll(".vs-cap").forEach(function (c) {
        var mine = c.dataset.ch === chapters[state.i].id, ss = [].slice.call(c.querySelectorAll(".vs-s"));
        var at = 0, now = mine ? (state.t === Infinity ? ss.length - 1 : 0) : -1;
        if (mine && state.t !== Infinity) ss.forEach(function (s, j) { if (state.t >= at) now = j; at += s.textContent.length / rate; });
        ss.forEach(function (s, j) { s.classList.toggle("vs-now", j === now); });
      });
      [].forEach.call(marks.children, function (b, i) {
        b.setAttribute("aria-current", String(i === state.i));
        var p = i < state.i ? 100 : i > state.i ? 0 : state.t === Infinity ? 100 : Math.min(100, (state.t / length(chapters[i])) * 100);
        b.firstChild.style.setProperty("--p", p + "%");
      });
      stage.querySelector(".vs-play").hidden = state.playing;
      stage.querySelector(".vs-pause").hidden = !state.playing;
    }
    function frame(now) {
      if (!state.playing) return;
      state.t += (now - state.last) / 1000; state.last = now;
      if (state.t >= length(chapters[state.i])) {
        if (state.i < chapters.length - 1) { state.i++; state.t = 0; } else { state.t = Infinity; state.playing = false; }
      }
      var name = drawName(chapters[state.i]);
      if (name) dash.draw(name);
      show();
      if (state.playing) state.raf = requestAnimationFrame(frame);
    }
    function play() {
      if (state.playing) return;
      if (state.t === Infinity) { if (state.i === chapters.length - 1 && state.last) state.i = 0; state.t = 0; }
      state.playing = true; state.last = performance.now();
      state.raf = requestAnimationFrame(frame);
      show();
    }
    function pause() { state.playing = false; cancelAnimationFrame(state.raf); show(); }
    function go(i) {
      var was = drawName(chapters[state.i]);
      state.i = Math.max(0, Math.min(chapters.length - 1, i)); state.t = state.playing ? 0 : Infinity;
      if (was) dash.draw(was);
      var name = drawName(chapters[state.i]);
      if (name) dash.draw(name);
      show();
    }
    stage.querySelector(".vs-play").addEventListener("click", play);
    stage.querySelector(".vs-pause").addEventListener("click", pause);
    stage.querySelector(".vs-back").addEventListener("click", function () { go(state.i - 1); });
    stage.querySelector(".vs-next").addEventListener("click", function () { go(state.i + 1); });
    stage.querySelector(".vs-cc").addEventListener("click", function (e) {
      var on = e.currentTarget.getAttribute("aria-pressed") !== "true";
      e.currentTarget.setAttribute("aria-pressed", String(on));
      if (caps) caps.classList.toggle("vs-off", !on);
    });
    var idle = 0;
    var hover = function () { return window.matchMedia && matchMedia("(hover: hover)").matches; };
    var wake = function () {
      stage.classList.remove("vs-idle"); clearTimeout(idle);
      if (state.playing && hover()) idle = setTimeout(function () { if (state.playing) stage.classList.add("vs-idle"); }, 3000);
    };
    stage.addEventListener("pointermove", wake); stage.addEventListener("pointerdown", wake); stage.addEventListener("focusin", wake);
    stage.addEventListener("pointerleave", function () { if (state.playing && hover()) stage.classList.add("vs-idle"); });
    dash.onData(show);
    show();
    return { play: play, pause: pause, go: go };
  };
})();
