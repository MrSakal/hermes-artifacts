# Visual short

A dashboard that plays: one finding told in a few chapters on one stage, each a drawing that builds
while a caption says what it shows, a minute or two in all. Built from datasets and marks like any
dashboard. `dash.short(scenes)` plays it (chapter marks, Play/Pause/Back/Next/CC, timing, cross-fades, captions, reduced motion, fit): you write the chapters, captions and scenes.

## What has to hold

- **One writer for each part** (`topic=editing`): words known as you write are in the HTML; each figure
  and chart is a `data-draw`; outside them a script sets only `class`, `style`, `aria-*`.
- **A mark holds its real value from the first draw.** A count-up number counts in an unmarked
  `aria-hidden="true"` copy laid over the marked one.
- **A scene is a function of its own `t`** (seconds; `Infinity` = whole, as at its end), so it can be held,
  replayed or jumped to; it writes only styles and attributes, not marks. Nothing in a chapter takes focus.
- **Every number in a caption is marked and filled from the data**; words that turn on the data come
  from a calc. Captions round for the ear ("about 1,900"); the stage shows the exact one.
- The engine does the rest: opens whole and at rest on the title (the thumbnail), plays only on Play or a
  mark, cross-fades chapters, fits the room (sizes inside in `cqi`), draws each chapter whole under
  `prefers-reduced-motion`.

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

`index.html`. Replace chapters, captions, datasets and `scenes`. Styles (`.vs …`) and controls come with
`dash.short`; `dash.short(scenes, {rate})` changes the caption pace (characters/s, default 15).

```html
<meta name="dash-one-writer">
<div class="vs" id="short"><div class="vs-stage">
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

dash.short(scenes);
</script>
```

Datasets: `months` (`month`, `n`); `said` is the calc. A chapter's drawing is named for its scene
(`data-draw="months"` → `scenes.months`). At hand-over say how long it runs and that Play starts it.
