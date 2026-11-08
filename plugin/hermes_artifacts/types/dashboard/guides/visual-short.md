# Visual short

A dashboard that plays: one finding told in a few chapters on one stage, each a drawing that builds
while a caption says what it shows, a minute or two in all. Built from datasets and marks like any
dashboard. Start from the skeleton below: it already does what has to hold.

## What has to hold

- **One writer for each part** (`topic=editing`): words known as you write are in the HTML; each figure
  and chart is a `data-draw`; outside them a script sets only `class`, `style`, `aria-*`.
- **A mark holds its real value from the first draw.** A chapter not playing is drawn whole (as at its
  end); only the playing one is drawn at its time. A count-up number counts in an unmarked
  `aria-hidden="true"` copy laid over the marked one.
- **Chapters share one place and cross-fade** with `opacity` (never `display: none`: a drawing there
  measures 0 wide). A chapter not showing is `aria-hidden`, takes no pointer; nothing in a chapter takes focus.
- **Captions hide from the eye only** (`opacity`): a screen reader gets every caption.
- **Motion is drawn from time, in script.** Each chapter is a function of its own `t` (seconds), whole
  at the end, so it can be held, replayed or jumped to. `t` runs in one animation-frame loop, stopped
  while nothing plays. Each frame writes only styles and attributes, not marks.
- **The reader starts it.** It opens on its title, whole and at rest (what a thumbnail shows), and plays
  only on Play or a chapter mark.
- **It fits its room**: stage width is set from the available height, keeping its shape;
  `container-type: inline-size` on wrapper and stage, sizes inside in `cqi`.
- **`prefers-reduced-motion: reduce`**: each chapter's drawing whole at once, only the fade.
- **Every number in a caption is marked and filled from the data**; words that turn on the data come
  from a calc. Captions round for the ear ("about 1,900"); the stage shows the exact one.

## Suggestions

- Five to seven chapters. First: a title (what, the period, how long it runs); last: what to do next,
  ending with every mark at full strength.
- Each chapter: small uppercase label, one-sentence headline stating the finding, the caption row
  (`.vs-say`, empty), one drawing filling its box, small muted source line.
- Captions: 150–250 characters, two to four sentences, each in its own `.vs-s`, written to be said aloud.
- Pace: a chapter lasts caption length / 15 seconds, plus 1; a mark's cue is where its word starts in
  the caption, / 15.
- Marks arrive: bars grow from zero, a value fades in once its bar lands, 400–700 ms, `d3.easeCubicOut`.
  Gray first, one accent (`dash.colors[0]`) on what the sentence is about. Labels on marks; no axes,
  gridlines or legends.

## The skeleton

`index.html` (one file here; split CSS/script out if you like). Replace chapters, captions, datasets
and `scenes`; keep the engine.

```html
<meta name="dash-one-writer">
<style>
#short.vs{container-type:inline-size;display:flex;justify-content:center;}
#short .vs-stage{position:relative;container-type:inline-size;width:min(100%, calc((100vh - 140px) * 16 / 9));aspect-ratio:16 / 9; background:var(--color-panel);border:1px solid var(--color-border-line);border-radius:var(--radius);overflow:hidden;}
@container (max-width:800px){#short .vs-stage{aspect-ratio:1 / 1;width:min(100%, calc(100vh - 140px));}}
@container (max-width:560px){#short .vs-stage{aspect-ratio:4 / 5;}}
#short .vs-marks{position:absolute;left:4cqi;right:4cqi;top:2.4cqi;display:flex;gap:.8cqi;z-index:3;}
#short .vs-mark{flex:1;height:1.6cqi;min-height:10px;padding:0;border:0;background:none;cursor:pointer;display:flex;align-items:center;}
#short .vs-mark i{display:block;width:100%;height:3px;border-radius:2px;background:color-mix(in srgb, var(--color-fg) 18%, transparent); background-image:linear-gradient(var(--color-fg), var(--color-fg));background-repeat:no-repeat;background-size:var(--p, 0%) 100%; forced-color-adjust:none;}
#short .vs-ctl{position:absolute;right:3cqi;top:4.6cqi;display:flex;gap:.6cqi;z-index:3;transition:opacity .3s;}
#short .vs-ctl button{width:max(28px, 3.6cqi);height:max(28px, 3.6cqi);border:0;border-radius:6px;background:none;color:var(--color-fg-muted);cursor:pointer;}
#short .vs-ctl button:hover{background:var(--color-hover);color:var(--color-fg);}
#short .vs-ctl svg{width:60%;height:60%;}
#short .vs-ctl .vs-cc{font:600 max(11px, 1.3cqi) var(--font-sans);}
#short .vs-ctl .vs-cc[aria-pressed="false"]{opacity:.45;}
#short .vs-stage.vs-idle .vs-ctl{opacity:0;}
#short .vs-ch{position:absolute;inset:0;padding:5.2cqi 4cqi 3cqi;display:grid;grid-template-rows:auto auto 7cqi 1fr auto;gap:1cqi; opacity:0;transition:opacity .45s;pointer-events:none;}
#short .vs-ch.vs-on{opacity:1;pointer-events:auto;}
#short .vs-label{margin:0;font:600 max(10px, 1.3cqi) var(--font-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--color-fg-muted);}
#short .vs-head{margin:0;font:400 max(18px, 3.4cqi)/1.15 var(--font-display);color:var(--color-fg);max-width:80%;}
#short .vs-draw{position:relative;container-type:size;min-height:0;font-size:max(11px, 1.8cqi);}
#short .vs-src{margin:0;font-size:max(10px, 1.3cqi);color:var(--color-fg-muted);}
#short .vs-caps{position:absolute;left:4cqi;right:4cqi;z-index:2;pointer-events:none;font-size:max(14px, 2cqi);line-height:1.4;}
#short .vs-cap{position:absolute;left:0;right:0;top:0;margin:0;}
#short .vs-s{position:absolute;left:0;right:0;top:0;opacity:0;transition:opacity .3s;}
#short .vs-s.vs-now{opacity:1;}
#short .vs-caps.vs-off .vs-s{opacity:0 !important;}
@media (forced-colors:active){#short .vs-mark i{background-color:GrayText;background-image:linear-gradient(CanvasText, CanvasText);}}
</style>

<div class="vs" id="short"><div class="vs-stage">
  <div class="vs-marks"><!-- one per chapter, named for its label --></div>
  <div class="vs-ctl">
    <button class="vs-play" aria-label="Play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
    <button class="vs-pause" aria-label="Pause" hidden><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg></button>
    <button class="vs-back" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg></button>
    <button class="vs-next" aria-label="Next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></button>
    <button class="vs-cc" aria-pressed="true" aria-label="Captions">CC</button>
  </div>

  <section class="vs-ch" id="ch-title" data-label="Q3 signups">
    <p class="vs-label">Q3 signups</p>
    <h2 class="vs-head">Signups grew every month this quarter</h2>
    <div class="vs-say"></div>
    <div class="vs-draw" data-draw="title" data-source="months" data-field="n" data-where="month=2026-09"></div>
    <p class="vs-src">Completed signups, July to September 2026</p>
  </section>
  <section class="vs-ch" id="ch-months" data-label="By month">
    <p class="vs-label">By month</p>
    <h2 class="vs-head">September was the strongest month</h2>
    <div class="vs-say"></div>
    <div class="vs-draw" data-draw="months" data-source="months"></div>
    <p class="vs-src">Completed signups per month</p>
  </section>

  <div class="vs-caps">
    <p class="vs-cap" data-ch="ch-title"><span class="vs-s">This is the quarter in signups, in about a minute.</span>
      <span class="vs-s">September ended at <b data-draw="say-sep" data-source="said" data-field="sep">—</b> signups.</span></p>
    <p class="vs-cap" data-ch="ch-months"><span class="vs-s">Each month beat the one before.</span>
      <span class="vs-s">September led, at <b data-draw="say-sep2" data-source="said" data-field="sep">—</b>.</span></p>
  </div>
</div></div>

<script>
dash.calc('said', { title: 'Rounded for the captions', inputs: ['months'],
  fn: (months) => ({ sep: Math.round(Number((months.find((r) => r.month === '2026-09') || {}).n || 0) / 100) * 100 }) });

const fmt = d3.format(',');
['say-sep', 'say-sep2'].forEach((n) => dash.draw(n, (el) => {
  const s = dash.data('said');
  el.textContent = s.status === 'ok' ? fmt(s.data.sep) : '—';
}));
const ease = d3.easeCubicOut;
const clamp = (x) => Math.max(0, Math.min(1, x));
// scene(el, t): the chapter at t seconds; t = Infinity is it whole.
const scenes = {
  title(el, t) {
    const m = dash.data('months');
    if (m.status !== 'ok') { el.textContent = '—'; return; }
    const v = Number((m.data.find((r) => r.month === '2026-09') || {}).n || 0);
    el.innerHTML = '';
    const big = d3.select(el).append('div')
      .attr('style', 'position:absolute;inset:0;display:grid;place-items:center;font:400 12cqi/1 var(--font-display);color:var(--color-fg)');
    big.text(fmt(v));
    const k = clamp(t / 1.2);
    if (k < 1) big.style('opacity', ease(k));
  },
  months(el, t) {
    const m = dash.data('months');
    el.innerHTML = '';
    if (m.status !== 'ok') { el.textContent = '—'; return; }
    const rows = m.data, max = d3.max(rows, (r) => Number(r.n)) || 1;
    const box = d3.select(el).append('div').attr('style', 'position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:2cqh');
    rows.forEach((r, i) => {
      const k = ease(clamp((t - i * 0.5) / 0.6)), w = (Number(r.n) / max) * 80 * k;
      const row = box.append('div').attr('style', 'display:flex;align-items:center;gap:1em;height:' + Math.min(18, 100 / rows.length) + 'cqh');
      row.append('span').attr('style', 'width:5em;color:var(--color-fg-muted)').text(r.month);
      row.append('div').attr('style', 'height:60%;border-radius:4px;width:' + w + '%')
        .style('background', i === rows.length - 1 ? dash.colors[0] : 'color-mix(in srgb, var(--color-fg) 22%, transparent)');
      row.append('span').style('opacity', k).text(fmt(Number(r.n)));
    });
  }
};

// ---- the engine (keep as it is)
(() => {
  const stage = document.querySelector('#short .vs-stage');
  if (!stage) return;
  const chapters = [...stage.querySelectorAll('.vs-ch')];
  const caps = stage.querySelector('.vs-caps');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const capOf = (ch) => stage.querySelector('.vs-cap[data-ch="' + ch.id + '"]');
  const length = (ch) => { const c = capOf(ch); return (c ? c.textContent.trim().length : 60) / 15 + 1; };
  const state = { i: 0, t: Infinity, playing: false, last: 0, raf: 0 };
  const marks = stage.querySelector('.vs-marks');
  marks.replaceChildren(...chapters.map((ch, i) => {
    const b = document.createElement('button');
    b.className = 'vs-mark'; b.setAttribute('aria-label', ch.dataset.label || ('Chapter ' + (i + 1)));
    b.append(document.createElement('i'));
    b.addEventListener('click', () => { go(i); play(); });
    return b;
  }));
  const drawName = (ch) => ch.querySelector('[data-draw]') && ch.querySelector('[data-draw]').dataset.draw;
  chapters.forEach((ch, i) => {
    const name = drawName(ch);
    if (name && scenes[name]) dash.draw(name, (el) => scenes[name](el, i === state.i && !reduce ? state.t : Infinity));
  });
  function show() {
    chapters.forEach((ch, i) => { ch.classList.toggle('vs-on', i === state.i); ch.setAttribute('aria-hidden', String(i !== state.i)); });
    const say = chapters[state.i].querySelector('.vs-say');
    if (say && caps) caps.style.top = (say.offsetTop) + 'px';
    stage.querySelectorAll('.vs-cap').forEach((c) => {
      const mine = c.dataset.ch === chapters[state.i].id, ss = [...c.querySelectorAll('.vs-s')];
      let at = 0, now = mine ? (state.t === Infinity ? ss.length - 1 : 0) : -1;
      if (mine && state.t !== Infinity) ss.forEach((s, j) => { if (state.t >= at) now = j; at += s.textContent.length / 15; });
      ss.forEach((s, j) => s.classList.toggle('vs-now', j === now));
    });
    [...marks.children].forEach((b, i) => {
      b.setAttribute('aria-current', String(i === state.i));
      const p = i < state.i ? 100 : i > state.i ? 0 : state.t === Infinity ? 100 : Math.min(100, (state.t / length(chapters[i])) * 100);
      b.firstChild.style.setProperty('--p', p + '%');
    });
    stage.querySelector('.vs-play').hidden = state.playing;
    stage.querySelector('.vs-pause').hidden = !state.playing;
  }
  function frame(now) {
    if (!state.playing) return;
    state.t += (now - state.last) / 1000; state.last = now;
    if (state.t >= length(chapters[state.i])) {
      if (state.i < chapters.length - 1) { state.i++; state.t = 0; } else { state.t = Infinity; state.playing = false; }
    }
    const name = drawName(chapters[state.i]);
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
    const was = drawName(chapters[state.i]);
    state.i = Math.max(0, Math.min(chapters.length - 1, i)); state.t = state.playing ? 0 : Infinity;
    if (was) dash.draw(was);
    const name = drawName(chapters[state.i]);
    if (name) dash.draw(name);
    show();
  }
  stage.querySelector('.vs-play').addEventListener('click', play);
  stage.querySelector('.vs-pause').addEventListener('click', pause);
  stage.querySelector('.vs-back').addEventListener('click', () => go(state.i - 1));
  stage.querySelector('.vs-next').addEventListener('click', () => go(state.i + 1));
  stage.querySelector('.vs-cc').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on)); caps.classList.toggle('vs-off', !on);
  });
  let idle = 0;
  const wake = () => { stage.classList.remove('vs-idle'); clearTimeout(idle); if (state.playing && matchMedia('(hover: hover)').matches) idle = setTimeout(() => state.playing && stage.classList.add('vs-idle'), 3000); };
  stage.addEventListener('pointermove', wake); stage.addEventListener('pointerdown', wake); stage.addEventListener('focusin', wake);
  stage.addEventListener('pointerleave', () => { if (state.playing && matchMedia('(hover: hover)').matches) stage.classList.add('vs-idle'); });
  dash.onData(show);
  show();
})();
</script>
```

Datasets: `months` (`month`, `n`); `said` is the calc. A chapter's drawing is named for its scene
(`data-draw="months"` → `scenes.months`). At hand-over say how long it runs and that Play starts it.
