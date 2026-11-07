# Editing by hand: a page with one writer for each part

The dashboard's Design panel has **Edit the page**: the person changes the page's words in place,
moves cards earlier or later and deletes them, with Undo and Redo, and every change saves as a new
version. For that to work, the page has one writer for each part:

- **Text you know as you write is in the HTML**: headings, sentences, notes, the labels of tiles,
  tabs, buttons, columns and series. No script writes or builds it. Outside a drawing a script only
  listens and sets `class`, `style`, `hidden`, `disabled`, `checked`, `value` or `aria-*`.
- **What the data decides is a drawing**: a number, a word that turns on the data, a chart with its
  tooltip, a `<tbody>`, a `<select>`'s choices. Each is an element marked `data-draw="name"` (with
  any `data-source` / `data-field` marks), stored holding no more than `—` (a table part, a list or a
  `<select>` stored empty). Keep a drawing as small as what changes: a word, not its sentence.

```html
<p>Sales met the <b data-draw="goal">—</b> goal in <b data-draw="met" data-source="weeks" data-field="met">—</b> weeks.</p>
```

- `dash.draw(name, fn)` runs `fn(el)` on each `data-draw="name"` after the scripts, whenever data, a
  filter or the width changes. `fn` leaves `el` holding only the current state (a full redraw or a d3
  join; where a status isn't `"ok"` the `—` comes back). `dash.draw(name)` runs it again.
  For something set up once: `dash.draw(name, {mount, update, unmount})`.
- **A drawing under `hidden`** (the attribute) isn't run: `dash.onData(fn)`, which runs before the
  drawings, shows and hides sections.
- A person may delete or move any element, so a script reaches elements with `querySelectorAll` and a
  loop, and never counts on one being there.
- A fixed reference the person chose (a goal, a limit) is one constant in a script, drawn wherever
  it shows, never typed into a sentence.

Open such a page's `index.html` with `<meta name="dash-one-writer">`. Before you change a page that has
it, read the file again (`artifact_read`): the person may have edited it by hand since you wrote it,
and their edits stay.

A dashboard drawn from `dashboard.json` `layout` can't be edited by hand. When the page asks you to
make it editable, rewrite it as an `index.html` by these rules, keeping what it shows and how it
looks; never add the `<meta>` line alone.
