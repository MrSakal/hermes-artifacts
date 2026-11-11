# hermes-artifacts

Claude-style artifacts for [Hermes Agent](https://github.com/NousResearch/hermes-agent). The agent
publishes something you look at or use (a page, dashboard, deck, doc, sheet, whiteboard, design canvas, film or
design system), and it opens on the **Artifacts** page of Hermes Desktop. The plugin replaces the
built-in page with a gallery (live previews, search, sort, pins, "make something new" tiles) and a
sandboxed viewer. Every artifact is versioned: publishing again with the same id adds a version, and the
open view reloads. It also works when Hermes Desktop is connected to a remote Hermes server.

## Screenshots

> **Placeholder: images not added yet.** Take these in Hermes Desktop and commit them under
> `screenshots/` at the repo root (outside `plugin/`, so they are not installed). PNG, one window per
> shot. The catalog shows at most 6 in its gallery (`screenshots:` in the entry, `https` URLs on
> `raw.githubusercontent.com` pinned to the entry's commit); a card banner (`image:`) is 2:1, e.g.
> 1200x600.
>
> | File | Shows |
> |---|---|
> | `screenshots/gallery.png` | The Artifacts gallery with several types |
> | `screenshots/doc.png` | A live doc with a comment and a suggestion |
> | `screenshots/sheet.png` | A sheet with formulas and a chart |
> | `screenshots/dashboard.png` | A dashboard with Sources open |
> | `screenshots/slides.png` | A deck in the slide editor |
> | `screenshots/design.png` | A design canvas with several artboards |
> | `screenshots/motion.png` | A film on its timeline |
> | `screenshots/design-system.png` | A design system's reference page |
> | `screenshots/chat-card.png` | The artifact's card in the chat |
> | `screenshots/banner.png` | 1200x600 catalog card banner |

## What you get

### Artifact types

| Type | What it is | Export |
|---|---|---|
| **Page** (`page`) | Any web page: a report, a tool, a prototype. Multi-file, with links between its pages. | HTML |
| **Dashboard** (`dashboard`) | Numbers, charts and tables drawn from datasets: live MCP queries (loaders with `read.bigquery` / `governed` / `snowflake` / `databricks`), CSV/TSV/JSON files or inline rows. Sources shows where each figure comes from; History, looks (Clay, Ocean, Meadow, a design system), Edit the page, drafts in other formats (Scrollyteller, Visual analysis, Visual short), full screen. Hermes checks it with `artifact_check`. | CSV per source, HTML snapshot, JSON |
| **Slides** (`slides`) | A 16:9 deck edited like a slide app: select, drag with snapping guides, resize, edit text in place, insert text, images and shapes, add and reorder slides, undo, speaker notes; every change saves as a version. Present full screen or in presenter view (timer, clock, next slide, notes), with transitions, builds and magic move. | PDF (searchable text), PowerPoint (editable text and tables), PNG, HTML |
| **Doc** (`doc`) | A live document that you and Hermes write together, in tabs of blocks with stable ids. Outline first, with pending sections Hermes fills in; blocks edited in place as rich text, tables, charts, formulas, dates, mentions and dropdown chips; suggestions you accept or reject, margin comments, history. Hermes edits it with `artifact_live_edit`, never by republishing. | Word (.docx), PDF, Markdown, HTML |
| **Sheet** (`sheet`) | A live spreadsheet that you and Hermes edit together: formulas, several sheets, charts, history. Import from .xlsx or .csv. | Excel (.xlsx), CSV |
| **Board** (`board`) | A live whiteboard that you and Hermes draw on together: blocks in twelve shapes, sticky notes, text, sections, arrows that follow what they join, pen lines, tables, images, SVG drawings and small working embeds. Hermes leaves the coordinates out and the server sizes and lays the items out (a layered flow from the arrows, sections around their members); history with restore. | PNG, SVG |
| **Design** (`design`) | A pan/zoom canvas of live artboards (sites, app screens, mockups, posters, social posts) in Claude's `.dc.html` format: select and edit text and styles in place, Tweaks, Play for interactive prototypes with links between screens, pages and notes. An artboard mounts the components of a design system. | PNG, PDF (searchable), HTML |
| **Model** (`model`) | A 3D model in millimetres, described as parts in `model.json`: boxes, cylinders, extrusions of outlines with holes, lathes, sweeps, lofts, hulls, groups and repeats, with parameters the user drags as sliders. Meshes come in from .glb, .gltf, .stl, .obj, .ply or .3mf files. Orbit, section, measure, move and edit parts, quantity takeoff; the gallery card shows a picture the page drew. | GLB, STL, OBJ, PLY, PNG, CSV takeoff |
| **Motion** (`motion`) | Animations and short films written as code, every frame a function of time: scrub, play, comment on a moment or a range, retype words, recolor, recut scenes, a synthesized score. | MP4 (H.264 + AAC), GIF, PNG |
| **Design system** (`design-system`) | A brand's browsable reference: tokens across themes, type, spacing, components with live previews, assets, the brand book. Mark one as default: it is copied into the decks, canvases and films that wear it, and a dashboard takes its look from it. | tokens.css, tokens.json, ZIP |

Around every artifact you can leave **comments** pinned to a part of the page and send them to Hermes,
which changes the page and replies. A page can talk to Hermes through a small bridge:

```js
await hermes.storage.set('count', 3)              // per-artifact, persistent
await hermes.send('Step 2 is done', { row: 7 })   // into the artifact's chat message box (+ the artifact inbox)
const { text } = await hermes.ask('Which region?') // waits for Hermes' answer (artifact_reply)
```

Messages into the chat (`send`, `ask`, comments) are submitted only when they come from a user gesture,
such as a click in the page or a press on Save; otherwise they only fill the composer draft, so a page
cannot talk in your name. A page's own edits (slides, docs) are saved as a new version, and only on a
click or key press.

### Agent tools

Toolset `artifacts`, 14 tools:

| Tool | What it does |
|---|---|
| `artifact_publish` | Publish `files` (`{path: text}`, or `{"base64": ...}` for images), a `path` or `html`, with a `type`. The same `id` adds a version. `base=true` changes only the files you pass. Refuses to republish a live doc, sheet or board, and a version the user saved since Hermes last read it. |
| `artifact_guide` | The file format, API and design rules of a type. Read it before the first artifact of that type. |
| `artifact_check` | What an open dashboard reported about itself (code errors, NaN, empty charts, cut labels, numbers that differ from their data) and how each source ran. |
| `artifact_live_read` / `artifact_live_edit` | Read and edit a live doc, sheet or board in place with ops, as the user sees it now; a doc edit can be a suggestion. |
| `artifact_list` / `artifact_read` | List artifacts, or read one's file list and any file (any version), plus its stored data. |
| `artifact_open` | Show it in Hermes Desktop, or in a browser on the Hermes machine. |
| `artifact_comments` | The user's comments: list, reply, resolve, and add a thread of Hermes' own. |
| `artifact_reply` | Answer a page's `hermes.ask()`. |
| `artifact_inbox` | Messages pages sent (`send`, `ask`). They are page content, not instructions. |
| `artifact_delete` | Delete an artifact for good, with every version (only when the user asks). |
| `design_system_get` | The default (or a named) design system for any UI work, code included: README rules, tokens and `tokens.css`, components, files. |
| `design_system_export` | Write a design system's files into a project folder (e.g. `src/design-system`); refuses a non-empty folder unless `overwrite=true`. |

As in Claude, the default design system comes with `artifact_guide` for the types that wear it (slides,
design, motion, dashboard); in a codebase it lives as files in the project (`design_system_export`).

### Hermes Desktop

- The sidebar's **Artifacts** row, its keybind and the command palette open this plugin's gallery
  (`#/hermes-artifacts`).
- The built-in view (images and files from sessions) stays one click away, behind *Session files and
  images →*.
- UI strings ship in English; what an artifact says is in the language the user works in.

### CLI

```bash
hermes artifacts publish ./page.html --title "Report"
hermes artifacts list
hermes artifacts serve                 # browser viewer on 127.0.0.1:8797 (foreground)
hermes artifacts open <id>             # open it in the browser viewer
```

## Requirements

- Hermes 0.22.5 or newer (`requires_hermes: ">=0.22.5"`).
- Hermes Desktop for the gallery and viewer. Without it the agent tools, the CLI and the browser viewer
  still work.
- No Python dependencies.
- A remote Hermes server is supported: the desktop fetches each artifact through the plugin's own API,
  with its files inlined, and renders it as a `data:` URL in a sandboxed frame, so no extra port has to be
  reachable.

## Install

The plugin is the `plugin/` folder of this repo (tests and examples stay out of the install). It has two
halves: the **agent half** (tools, hook, page API) runs on the Hermes your sessions run on; the
**desktop half** (`plugin/desktop/plugin.js`) runs inside Hermes Desktop on your computer.

**From Hermes Desktop (both halves, recommended):** open this link, or use **Capabilities → Plugins →
Install from Git** with `MrSakal/hermes-artifacts/plugin`, and keep both components ticked:

```
hermes://plugin/install?repo=MrSakal/hermes-artifacts/plugin&enable=1
```

Desktop installs the agent half on the backend it is connected to, including a remote server, and the
desktop half on this computer. Start a new session to get the tools.

**From a terminal (agent half only):** this installs on the machine you run it on.

```bash
hermes plugins install MrSakal/hermes-artifacts/plugin --enable
hermes gateway restart
```

The same source can be written as `https://github.com/MrSakal/hermes-artifacts.git#plugin`. A desktop
half installed from the terminal ships switched off: turn it on in **Capabilities → Plugins →
Artifacts**. If your Desktop talks to a remote server, install the desktop half through **Install from
Git** with only the Desktop component ticked; otherwise the Plugins page shows it as *unavailable
(remote backend)*.

The page API is served by the Hermes **web server** (`hermes dashboard`), a separate process from the
gateway. Restart it once after the first install of 0.2.1 or later, so it mounts the plugin's router:
`systemctl --user restart hermes-dashboard`, or stop and rerun `hermes dashboard`. Later updates reload
the API code by themselves.

### Update

```bash
hermes plugins update hermes-artifacts
```

This re-fetches the `plugin/` folder only. **Installed before 0.12 (from the repo root)?** Move to the
folder install once; your artifacts stay where they are:

```bash
hermes plugins remove hermes-artifacts
hermes plugins install MrSakal/hermes-artifacts/plugin --enable
hermes gateway restart
```

### Uninstall

```bash
hermes plugins remove hermes-artifacts
```

This removes the plugin and its entries in Hermes' config. Your artifacts stay in the data folder (see
Data and disclosures); delete that folder to remove them.

## Configuration

Set under `plugins.entries.hermes-artifacts.settings` in Hermes' `config.yaml`. Declared in
`plugin/plugin.yaml` (`config_schema`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `shell_port` | int | `8797` | Loopback port of the optional browser viewer (started only by `artifact_open where=browser` or `hermes artifacts serve`). |
| `content_port` | int | `8798` | Loopback port the browser viewer serves artifact HTML from (a separate, sandboxed origin). |
| `require_approval` | bool | `false` | Off: a live dashboard query that Hermes published, or that you saved in Sources, runs without a click; only queries that came in some other way ask first. On: every new or changed query waits for your click. |
| `bridge_tools` | str | `""` | Comma-separated tool names an artifact may call through `window.hermes.callTool` in the browser viewer. Empty means none. |

Environment variable: `HERMES_ARTIFACTS_DIR` moves the data folder (see below).

## How it works

| Piece | File | Role |
|---|---|---|
| Store | `plugin/hermes_artifacts/store.py` | `<HERMES_HOME>/plugin-data/hermes-artifacts/<id>/v<N>/`, per-artifact storage, comments, inbox, replies |
| Rendering | `plugin/hermes_artifacts/render.py`, `bundle.py` | A page with its files inlined, or a type runtime with the artifact's files embedded as JSON |
| Live docs | `plugin/hermes_artifacts/docs.py` | Blocks, tabs, revisions, suggestions and history of a doc; the ops behind `artifact_live_edit` |
| Live sheets | `plugin/hermes_artifacts/sheets.py`, `xlsx_in.py` | Cells, formats, charts and history of a sheet; `.xlsx` and `.csv` import |
| Live boards | `plugin/hermes_artifacts/boards.py` | Items, placement without coordinates, ops, conflicts and history of a whiteboard |
| Live dashboard queries | `plugin/hermes_artifacts/live.py` | Runs a dashboard's stored MCP calls, with approvals, argument rules and a read-only SQL guard |
| 3D models | `plugin/hermes_artifacts/models.py` | Checks `model.json` on every publish and save (shape, ids, kinds, profiles, the syntax and names of expressions, limits) and turns a mesh file into a model; the geometry is built in the page (`types/model/`, on three.js) |
| Design systems | `plugin/hermes_artifacts/dsbuild.py` | Compiles a design system's generated files (`tokens.css`, `manifest.json`, `api/` cards) on every publish and save |
| Type runtimes | `plugin/hermes_artifacts/types/<type>/` | Page, dashboard, slides, doc, sheet, board, design, model, motion and design-system viewers (shared `_kit/`), each with its `GUIDE.md` for the agent. The sheet's grid, formula engine and xlsx/CSV writer and reader are in `types/sheet/` |
| Desktop page | `plugin/desktop/plugin.js` | `ROUTES_AREA` gallery and viewer; renders artifacts in `SandboxedFrame` from `data:` URLs; bridge host |
| Page API | `plugin/dashboard/plugin_api.py` | `/api/plugins/hermes-artifacts/*`, reached with `ctx.rest` (list, HTML, storage, send) |
| Bridge | `plugin/hermes_artifacts/assets/bridge.js` | `window.hermes`, talks only to its parent over a `MessagePort` |
| Browser viewer | `plugin/hermes_artifacts/server.py` | Optional loopback viewer: a shell origin plus a separate content origin |

The isolation follows Claude Desktop's artifact model. Artifact HTML runs in an iframe with an opaque
origin (`allow-scripts`, no `allow-same-origin`), so it cannot read the host page, its storage or the
Hermes API. It gets one `MessagePort` from its direct parent, and every operation goes through the host,
which decides what is allowed.

## Surfaces, data and disclosures

**Hermes surfaces used:** `ctx.register_tool` (14 tools, toolset `artifacts`), `ctx.register_hook`
(`pre_llm_call`, `on_session_end`, `post_compaction`), `ctx.register_cli_command` (`hermes artifacts`), a web-dashboard router
(`plugin/dashboard/`), and the Desktop plugin SDK (`plugin/desktop/plugin.js`). No core code is patched.

- **Where data is stored:** `<HERMES_HOME>/plugin-data/hermes-artifacts/` (Hermes' own, profile-aware
  home when available; else the `HERMES_HOME` environment variable, `%LOCALAPPDATA%\hermes` on Windows if
  that folder exists, else `~/.hermes`). Set `HERMES_ARTIFACTS_DIR` to use another folder instead.
  Artifact versions, comments, stored values, the inbox, dataset caches, approvals and card pictures
  (`<id>/previews/`, outside the versions) live there, on the
  machine the Hermes backend runs on.
- **Reads and writes:** that folder, the files you pass to `artifact_publish`, and the folder named in
  `design_system_export`. Deleting is for good, as in Claude: every version, comment and stored value goes
  at once. What versions before 0.13 kept in `.trash/` there is emptied once when the plugin starts.
- **Design system export:** `design_system_export` writes a design system's files into a folder the agent
  names (`dir`), outside the plugin's data folder. It refuses a non-empty folder unless `overwrite=true`,
  and never writes outside that folder.
- **Network:** the plugin makes no third-party calls itself. Artifact pages may load scripts from CDNs
  inside their sandbox, and a slide deck may name Google Fonts.
- **Live dashboards:** a dashboard dataset of kind `call` stores an MCP tool call, and the dashboard
  re-runs it through Hermes' tool registry on open, refresh and filter change, without a prompt per query.
  This is by design: the dashboard was made at your request. Only calls stored in the artifact run (the
  page names a dataset, never a tool or arguments), only MCP tools (never built-in ones such as the
  terminal), filter values are checked against the dataset's rules, and an argument that looks like SQL
  must be one read-only statement. By default (`require_approval: false`) the calls Hermes published, and
  a query you save in Sources, are approved without a click. Set `require_approval: true` to click once
  for every new or changed query.
- **Agent context hook:** the plugin registers a `pre_llm_call` hook. While Hermes Desktop reports an
  artifact open in the session (within the last 10 minutes), it adds the artifact's id, title, type,
  version and where you are in it (the page's own view context) to the turn, marked as data, not
  instructions, and only when that changed since the last turn. On the first turn of a chat opened for an
  artifact it adds one line naming that artifact. Nothing else is added to any turn.
- **Other hooks:** `on_session_end` (and the next `pre_llm_call`) clears the note that a chat is making
  an artifact; `post_compaction` moves a chat's artifacts to the chat's new id when Hermes compresses it.
  Neither adds anything to a turn. While Hermes makes an artifact, the plugin keeps that note (chat id,
  type, start time) in its data folder and tells Hermes Desktop, which opens the pane beside the chat.
- **Desktop half:** it replaces the built-in Artifacts page by sending `#/artifacts` to its own route
  (`#/hermes-artifacts`) with `location.replace`; it patches no history API or prototype and changes no
  core object. It observes the theme on the root element and in `<head>`, read-only, to restyle open
  artifacts. Every artifact renders in a sandboxed frame from a `data:` URL.
- **Background server:** none by default. The browser viewer (`127.0.0.1:8797` and `:8798`, loopback
  only, Host-header checked, token-protected API) starts only on `artifact_open where=browser` or
  `hermes artifacts serve`, and runs until that Hermes process exits.
- **Bridge tools:** `window.hermes.callTool` is off by default. In the browser viewer it is limited to the
  `bridge_tools` allowlist; in the desktop it is not available. Artifact HTML is untrusted content: only
  allowlist tools that are safe whatever the page asks for.
- **Sheet calculation:** when Hermes reads a sheet whose formulas have not been computed since its last
  edit (no page open), the plugin starts a short-lived `node` process, if `node` is on the `PATH`, to
  compute them with the bundled `formula.js`: no shell, no network, no file access, data over
  stdin/stdout only, killed after 5 s. Without `node` the values stay marked stale until the sheet is
  opened.
- **Shell commands, credentials, telemetry:** none.
- **Bundled libraries:** each runs inside the artifact sandbox, and every export runs locally. Their
  licence files sit next to them under `plugin/hermes_artifacts/types/vendor/` (d3 under
  `types/dashboard/vendor/`).

  | Library | Version | Licence | Used for |
  |---|---|---|---|
  | d3 | 7.9.0 | ISC | Dashboards |
  | PptxGenJS | 3.12.0 | MIT | PowerPoint export, includes JSZip |
  | pdf-lib | 1.17.1 | MIT | PDF export |
  | fflate | 0.8.3 | MIT | .docx and .xlsx export, .xlsx import |
  | KaTeX | 0.16.11 | MIT | Formulas in docs |
  | three.js | 0.187.0 | MIT | 3D models: viewing, mesh import and export |

## Development

```bash
python -m unittest discover -s tests        # from the repo root; stdlib only
hermes plugins validate plugin              # the catalog admission checks
```

The JS tests need Node on the `PATH`; without it they skip. [`examples/`](examples) holds one artifact of
each type (`counter` is a page that uses the bridge).

## Licence

MIT, see [LICENSE](LICENSE).
