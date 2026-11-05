# Slides artifacts

A deck of 16:9 slides that people page through, present, edit in place and export to PDF, PowerPoint,
PNG or HTML.

## Files (`artifact_publish type=slides files={...}`)

- `deck.json`: `{"title": "Q3 review", "order": ["cover", "plan", "next"], "cover": "cover"}`.
  Optional fonts: `"faces": {"inter": {"family": "Inter", "href": "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap"}}`.
- `slides/<id>.html`, one per slide: exactly one `<section id="<id>" style="...">`, nothing around it.
- Images: files of the artifact (`img/photo.jpg`), named by path in `<img src>`.

## The slide format

A slide is a fixed 1920×1080 px canvas, with every style inline. On the `<section>`:
- `background` (always);
- the text defaults (`color`, `font-family`);
- the layout: `display:flex; flex-direction:column` by default, or `display:grid`; `padding:128px`
  for the margins; `gap`, `align-items`, `justify-content`.

`position:absolute` pins a child to the slide. Give pinned text a `width`.

Elements:
- text: `<h1> <h2> <h3> <p>` (set `font-size`, never under 24px), `<ul>` and `<ol>` of `<li>`;
- inline: `<b> <i> <u> <a href> <span style="color:…">`;
- containers: `<div>` (flex or grid, painted with `background`, `border`, `border-radius`);
- media: `<img style="width;height;object-fit">`, `<table>` (a `<th>` header row), `<svg aria-label>`
  for charts and diagrams.

No scripts, iframes or forms.

Speaker notes: plain text in one `<aside>`, the section's last child.

Motion while presenting:
- `data-transition="fade|push"` on a section sets how it leaves;
- `data-build-in="fade|rise|pop"` on pinned children makes them appear one click at a time.

PowerPoint export keeps text, lists and tables editable and turns SVG and images into pictures.
Gradients export as their first color. PDF and PNG are pictures of the slides.

## Designing

- One idea per slide. A statement beats bullets; big numbers, tables and card rows beat lists.
- One dark, one light and one or two accent colors.
- One type scale of four or five sizes. Text contrast at least 4.5:1.
- The area inside the margins is 824 px high: split a slide rather than shrink its text.
- Repeated elements keep their places, such as the heading at the top margin on every content slide.

## Changing it

The user can edit text on a slide and save it, so read the deck before you change it. Republish with
the same `id`, `base=true` and only the changed files. `"slides/<id>.html": null` removes a slide;
take it out of `order` too.
