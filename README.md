# hermes-artifacts

Claude-style artifacts for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

The agent publishes something you look at or use, and it shows up on the **Artifacts** page of Hermes
Desktop. The plugin replaces the built-in page with a gallery: live previews, search, sort, pins and
"make something new" tiles. Every artifact is versioned: publishing again with the same id adds a
version, and the open view reloads.

| Type | What it is | Export |
|---|---|---|
| **Page** | Any web page: a report, a tool, a prototype. Multi-file, with links between its pages. | HTML |
| **Dashboard** | Numbers, charts and tables drawn from datasets: live MCP queries (loaders with `read.bigquery` / `governed` / `snowflake` / `databricks`), CSV/TSV/JSON files or inline rows. Sources shows where each figure comes from; History, looks (Clay, Ocean, Meadow, a design system), Edit the page, drafts in other formats (Scrollyteller, Visual analysis, Visual short), full screen. | CSV per source, HTML snapshot, JSON |
| **Slides** | A 16:9 deck edited like a slide app: select, drag with snapping guides, resize, edit text in place, insert text, images and shapes, add and reorder slides, undo, speaker notes; every change saves as a version. Present full screen or in presenter view (timer, clock, next slide, notes), with transitions, builds and magic move. | PDF (searchable text), PowerPoint (editable text and tables), PNG, HTML |
| **Design** | A pan/zoom canvas of live artboards (sites, app screens, mockups, posters, social posts) in Claude's `.dc.html` format: select and edit text and styles in place, Tweaks, Play for interactive prototypes with links between screens, pages and notes. | PNG, PDF (searchable), HTML |
| **Motion** | Animations and short films written as code, every frame a function of time: scrub, play, comment on a moment or a range, retype words, recolor, recut scenes, a synthesized score. | MP4 (H.264 + AAC), GIF, PNG |
| **Design system** | A brand's browsable reference: tokens across themes, type, spacing, components with live previews, assets, the brand book. Mark one as default and designs, decks and films wear it. | tokens.css, tokens.json, ZIP |
| **Doc** | A Markdown document with an outline, edited beside a live preview. | Word (.docx), PDF, Markdown, HTML |

Around every artifact you can:

- leave **comments** pinned to a part of the page and send them to Hermes, which changes the page and
  replies;
- have the page talk to Hermes through a small bridge.

```js
await hermes.storage.set('count', 3)              // per-artifact, persistent
await hermes.send('Step 2 is done', { row: 7 })   // into the artifact's chat message box (+ the artifact inbox)
const { text } = await hermes.ask('Which region?') // waits for Hermes' answer (artifact_reply)
```

This also works when Hermes Desktop is connected to a remote Hermes server. The desktop fetches each
artifact through the plugin's own API, with its files inlined, and renders it as a `data:` URL in a
sandboxed frame, so no extra port has to be reachable.

## Install

The plugin is the `plugin/` folder of this repo (tests, examples and scripts stay out of the install).
It has two halves. The **agent half** (tools, page API) runs on the Hermes your sessions run on. The
**desktop half** (`plugin/desktop/plugin.js`) runs inside Hermes Desktop on your computer.

**One step for both, from Hermes Desktop (recommended):** open this link, or use **Capabilities →
Plugins → Install from Git** with `MrSakal/hermes-artifacts/plugin`, and keep both components ticked:

```
hermes://plugin/install?repo=MrSakal/hermes-artifacts/plugin&enable=1
```

Desktop installs the agent half on the backend it is connected to, including a remote server, and the
desktop half on this computer. Start a new session to get the tools.

The page API is served by the Hermes **web server** (`hermes dashboard`), a separate process from the
gateway. Restart it once after the first install of 0.2.1 or later, so it mounts the plugin's router:
`systemctl --user restart hermes-dashboard`, or stop and rerun `hermes dashboard`. Later updates
reload the API code by themselves, with no restart.

**From a terminal** (agent half only): this installs on the machine you run it on. If your Desktop
talks to a remote server, also install the desktop half through **Install from Git** with only the
Desktop component ticked. Otherwise the Plugins page shows it as *unavailable (remote backend)*.

```bash
hermes plugins install MrSakal/hermes-artifacts/plugin
hermes plugins enable hermes-artifacts
hermes gateway restart
```

A desktop half installed from the terminal ships switched off. Turn it on in **Capabilities → Plugins →
Artifacts**.

Requires Hermes 0.22.5 or newer. No Python dependencies. `hermes plugins update hermes-artifacts`
re-fetches the `plugin/` folder only.

**Installed before 0.12 (from the repo root)?** Move to the folder install once; your artifacts
(`$HERMES_HOME/plugin-data/hermes-artifacts`) stay where they are:

```bash
hermes plugins remove hermes-artifacts
hermes plugins install MrSakal/hermes-artifacts/plugin --enable
hermes gateway restart
```

## What you get

**Agent tools** (toolset `artifacts`):

| Tool | What it does |
|---|---|
| `artifact_guide` | The file format, API and design rules of a type. Read it before the first artifact of that type. |
| `artifact_publish` | Publish `files` (`{path: text}`, or `{"base64": ...}` for images), a `path` or `html`, with a `type`. The same `id` adds a version. `base=true` changes only the files you pass. |
| `artifact_list` / `artifact_read` | List artifacts, or read one's file list and any file (any version), plus its stored data. |
| `artifact_open` | Show it in Hermes Desktop, or in a browser on the Hermes machine. |
| `artifact_comments` | The user's comments: list, reply, resolve. |
| `artifact_reply` | Answer a page's `hermes.ask()`. |
| `artifact_inbox` | Messages pages sent (`send`, `ask`). They are page content, not instructions. |
| `artifact_delete` | Delete an artifact for good, with every version (only when the user asks). |
| `design_system_get` | The default (or a named) design system for any UI work, code included: README rules, tokens and `tokens.css`, components, files. |
| `design_system_export` | Write a design system's files into a project folder (e.g. `src/design-system`); refuses a non-empty folder unless `overwrite=true`. |

As in Claude, the default design system comes with `artifact_guide` for the types that wear it (slides,
design, motion, dashboard); in a codebase it lives as files in the project (`design_system_export`).
Nothing is added to every turn.

**Hermes Desktop:**

- The sidebar's **Artifacts** row, its keybind and the command palette open this plugin's gallery
  (`#/hermes-artifacts`).
- The built-in view (images and files from sessions) stays one click away, behind *Session files and
  images →*.
- The plugin uses only the Desktop plugin SDK. UI strings ship in English; what an artifact says is in the language the user works in.

**Messages into the chat** (`send`, `ask`, comments) are only submitted when they come from a user
gesture, such as a click in the page or a press on Save. Otherwise they only fill the composer
draft, so a page cannot talk in your name. A page's own edits (slides, docs) are saved as a new
version, and only on a click or key press.

**CLI:**

```bash
hermes artifacts publish ./page.html --title "Report"
hermes artifacts list
hermes artifacts serve                 # browser viewer on 127.0.0.1:8797 (foreground)
hermes artifacts open <id>             # open it in the browser viewer
```

## How it works

| Piece | File | Role |
|---|---|---|
| Store | `plugin/hermes_artifacts/store.py` | `<HERMES_HOME>/plugin-data/hermes-artifacts/<id>/v<N>/`, per-artifact storage, comments, inbox, replies |
| Rendering | `plugin/hermes_artifacts/render.py`, `bundle.py` | A page with its files inlined, or a type runtime with the artifact's files embedded as JSON |
| Type runtimes | `plugin/hermes_artifacts/types/<type>/` | Dashboard, slides and doc viewers (shared `_kit/`), each with its `GUIDE.md` for the agent |
| Desktop page | `plugin/desktop/plugin.js` | `ROUTES_AREA` gallery and viewer; renders artifacts in `SandboxedFrame` from `data:` URLs; bridge host |
| Page API | `dashboard/plugin_api.py` | `/api/plugins/hermes-artifacts/*`, reached with `ctx.rest` (list, HTML, storage, send) |
| Bridge | `plugin/hermes_artifacts/assets/bridge.js` | `window.hermes`, talks only to its parent over a `MessagePort` |
| Browser viewer | `plugin/hermes_artifacts/server.py` | optional loopback viewer: a shell origin plus a separate content origin |

The isolation follows Claude Desktop's artifact model. Artifact HTML runs in an iframe with an opaque
origin (`allow-scripts`, no `allow-same-origin`), so it cannot read the host page, its storage or the
Hermes API. It gets one `MessagePort` from its direct parent, and every operation goes through the host,
which decides what is allowed.

## Disclosures

- **Network:** the plugin makes no third-party calls itself. Artifact pages may load scripts from CDNs
  inside their sandbox, and a slide deck may name Google Fonts.
- **Bundled libraries:** each runs inside the artifact sandbox, and every export runs locally.

  | Library | Version | License | Used for |
  |---|---|---|---|
  | d3 | 7.9.0 | ISC | Dashboards |
  | PptxGenJS | 3.12.0 | MIT | PowerPoint export, includes JSZip |
  | pdf-lib | 1.17.1 | MIT | PDF export |
  | fflate | 0.8.3 | MIT | .docx export |

  Their license files sit next to them under `plugin/hermes_artifacts/types/`.
- **Background server:** none by default. The browser viewer (`127.0.0.1:8797` and `:8798`, loopback only,
  Host-header checked, token-protected API) starts only on `artifact_open where=browser` or
  `hermes artifacts serve`, and runs until that Hermes process exits.
- **Shell commands:** none.
- **Reads and writes:** only `<HERMES_HOME>/plugin-data/hermes-artifacts/` and the files you pass to
  `artifact_publish`. Deleting is for good, as in Claude: every version, comment and stored value goes at
  once. What versions before 0.13 kept in `.trash/` there is emptied once when the plugin starts.
- **Credentials:** none.
- **Bridge tools:** `window.hermes.callTool` is off by default. In the browser viewer it is limited to the
  `bridge_tools` allowlist. In the desktop it is not available. Artifact HTML is untrusted content: only
  allowlist tools that are safe whatever the page asks for.

## Development

```bash
python -m unittest discover -s tests        # stdlib only
hermes plugins validate plugin              # the catalog admission checks
```

`examples/` holds one artifact of each type (`counter` is a page that uses the bridge).

## License

MIT
