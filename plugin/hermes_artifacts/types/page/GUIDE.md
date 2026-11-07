# Page artifacts

Any web page: a report, a small tool, a prototype, a game, a visualization.

`index.html` is the entry. The artifact's other files (CSS, JS, images, more `.html` pages) are
inlined when it opens, and links between its pages work. CDN scripts load as usual.

The page runs sandboxed and gets `window.hermes`:

| Call | What it does |
|---|---|
| `hermes.storage.get/set/remove/list` | Per-artifact data that persists. |
| `hermes.send(text, data, opts)` | Puts a message into the artifact's chat message box, for the user to send (and into the artifact inbox). `{deliver: "send"}` asks the user to confirm, then sends it. |
| `hermes.ask(text, data)` | Asks you (after the user confirms sending it) and returns `Promise<{text, data}>`. Answer it with `artifact_reply`. |
| `hermes.download(name, content, type)` | Saves a file the page made. |

When the request is a dashboard, a slide deck or a doc, use that type instead.
