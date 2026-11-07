# Drafts: the dashboard in another format

In the Design panel the person can pick a format for a new draft: **Dashboard**, **Scrollyteller**,
**Visual analysis** or **Visual short**. The page writes `drafts/<id>/request.json`
(`{format, at, by}`) and sends you a message that starts `[draft request drafts/<id>]`. A draft is
written beside the dashboard; nothing changes for the dashboard until the person presses Save on the
page (Save copies the draft over the page; Cancel throws it away; Undo / Redo switch between the
dashboard as it is and the draft).

## Writing one

1. Only for such a request. `artifact_read` the artifact: if `drafts/<id>/request.json` isn't there, the
   draft was cancelled or replaced: write nothing, and say they can pick a format under Design again.
2. Explore the data first, with your own queries where they help, and let what you learn shape the page.
3. Write the whole new page as `drafts/<id>/index.html`, with any `.css` / `.js` it names beside it, with
   `artifact_publish id=<id> base=true files={"drafts/<id>/index.html": …}`. None of the old page's
   files load with it: copy in what you reuse (a `dash.calc`, a `dash.loader`, a helper).
4. Sources stay where they are: the draft reads the dashboard's datasets by id. Only a source that is
   new, or whose call changes, goes whole into `drafts/<id>/datasets.json` (`{<id>: {…}}`); changed
   filter defaults into `drafts/<id>/params.json`. A draft holds nothing else.
5. Leave the dashboard's own files (`dashboard.json`, `index.html`, …) alone.
6. Read the check as after any publish. At hand-over say that Save makes it the dashboard, Cancel throws
   it away, and Undo / Redo switch between the two; and in a line what was left out.

## What carries over

- **The same numbers.** Keep each calc's id and fn and each dataset's call.
- **A figure keeps its base when its filter goes**, or its sentence says the new base.
- **Words that turn on the data are filled from it** (up, down, fell behind), headlines too.
- **A story carries less than a board**: start from what the dashboard is for, choose the finding it
  serves, keep what tells it. Tiles fold into sentences, filters usually stay behind.

## The formats

- **Dashboard** — cards to watch at a glance: a one-line title, a takeaway sentence, the figure nearest
  the outcome first (about six at most), charts in cards each with its title and time window.
- **Scrollyteller** (scroll story) — a finding told as the reader scrolls: short chapters of text in one
  column beside one chart that stays in view (`position: sticky`) and changes as each chapter reaches
  the middle (an `IntersectionObserver` with `root: document`); one idea a chapter, its numbers marked;
  when narrow, the chart stays on top and the text scrolls under it.
- **Visual analysis** — a finding read top to bottom: the finding in a sentence around one number, then
  a chart under each heading that says what it shows; one accent series, the rest muted.
- **Visual short** — a minute or two that plays: read `artifact_guide type=dashboard topic=visual-short`
  and start from its skeleton.

Every new page follows `artifact_guide type=dashboard topic=editing` (one writer for each part), so the
person can reword it by hand afterwards.
