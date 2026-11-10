# Resolving a selected element or element comment

`selected` (`"<File>.dc.html#<tid>:<path>"`), "Ask Hermes" (`{artboard, element, selector}`) and element
comments (anchored at e.g. `Main.dc.html#13:1/1/0/1`) all name an element this way.

- Artboard names = file name, stem percent-encoded (`encodeURIComponent`); encode yours to compare.
- Resolve `Main.dc.html#5:1/1/0` in the file's text strictly between `<x-dc>` and the last `</x-dc>`:
  tid = element index in document order from 0 (`<helmet>` and its tags, `<sc-for>`, `<sc-if>`,
  `<dc-import>` count; text doesn't). Path = top-level index, then element-child index per level.
- Skeleton example: `<helmet>` `0:0`, `<style>` `1:0/0`, root `<div>` `2:1`, `<h1>` `3:1/0`.
- Inside `<sc-for>`: one entry however often rendered; clicks inside `<dc-import>` select it.
- Mismatch with your copy: re-read the file.

`selection`: `{id, kind (text|image|shape|line|other), label, path, text}`; `label` = TEMPLATE text (holes
as written), `text` = shown now.

An element comment: resolve it likewise, change the file, reply, resolve the comment.
