# hermes-artifacts

Claude-style artifacts for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

The agent publishes something you look at or use, and it shows up on the **Artifacts** page of Hermes
Desktop. The plugin replaces the built-in page with a gallery: live previews, search, sort, pins and
"make something new" tiles. Every artifact is versioned: publishing again with the same id adds a
version, and the open view reloads.

| Type | What it is | Export |
|---|---|---|
| **Page** | Any web page: a report, a tool, a prototype. Multi-file, with links between its pages. | HTML |
| **Dashboard** | Numbers, charts and tables drawn from datasets (CSV/TSV/JSON or inline rows). "Where numbers come from" shows each figure's source row. | CSV per source, HTML snapshot, JSON |
| **Slides** | A 16:9 deck: a thumbnail rail, in-place text editing, and presenting with transitions and builds. | PDF, PowerPoint (editable text and tables), PNG, HTML |
| **Doc** | A Markdown document with an outline, edited beside a live preview. | Word (.docx), PDF, Markdown, HTML |

Around every artifact you can:

- leave **comments** pinned to a part of the page and send them to Hermes, which changes the page and
  replies;
- have the page talk to Hermes through a small bridge.

```js
await hermes.storage.set('count', 3)              // per-artifact, persistent
await hermes.send('Step 2 is done', { row: 7 })   // a message into the chat + the artifact inbox
const { text } = await hermes.ask('Which region?') // waits for Hermes' answer (artifact_reply)
```

This also works when Hermes Desktop is connected to a remote Hermes server. The desktop fetches each
artifact through the plugin's own API, with its files inlined, and renders it as a `data:` URL in a
sandboxed frame, so no extra port has to be reachable.

## Install

The plugin has two halves in one repo. The **agent half** (tools, page API) runs on the Hermes your
sessions run on. The **desktop half** (`desktop/plugin.js`) runs inside Hermes Desktop on your computer.

**One step for both, from Hermes Desktop (recommended):** open this link, or use **Capabilities →
Plugins → Install from Git** with `MrSakal/hermes-artifacts`, and keep both components ticked:

```
hermes://plugin/install?repo=MrSakal/hermes-artifacts&enable=1
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
hermes plugins install MrSakal/hermes-artifacts
hermes plugins enable hermes-artifacts
hermes gateway restart
```

A desktop half installed from the terminal ships switched off. Turn it on in **Capabilities → Plugins →
Artifacts**.

Requires Hermes 0.22.5 or newer. No Python dependencies.

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
| `artifact_delete` | Move an artifact to the plugin's trash folder. |
| `artifact_desktop_cdp` | Only where Hermes Desktop is installed: attach to it over CDP, or launch it with a debugging port. |

**Hermes Desktop:**

- The sidebar's **Artifacts** row, its keybind and the command palette open this plugin's gallery
  (`#/hermes-artifacts`).
- The built-in view (images and files from sessions) stays one click away, behind *Session files and
  images →*.
- The plugin uses only the Desktop plugin SDK. UI strings ship in English and Hungarian.

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
hermes artifacts cdp [--port 9222]     # attach to / launch the local Hermes Desktop with CDP
hermes artifacts cdp --restart         # restart a running Hermes Desktop that has no port
```

## How it works

| Piece | File | Role |
|---|---|---|
| Store | `hermes_artifacts/store.py` | `<HERMES_HOME>/plugin-data/hermes-artifacts/<id>/v<N>/`, per-artifact storage, comments, inbox, replies |
| Rendering | `hermes_artifacts/render.py`, `bundle.py` | A page with its files inlined, or a type runtime with the artifact's files embedded as JSON |
| Type runtimes | `hermes_artifacts/types/<type>/` | Dashboard, slides and doc viewers (shared `_kit/`), each with its `GUIDE.md` for the agent |
| Desktop page | `desktop/plugin.js` | `ROUTES_AREA` gallery and viewer; renders artifacts in `SandboxedFrame` from `data:` URLs; bridge host |
| Page API | `dashboard/plugin_api.py` | `/api/plugins/hermes-artifacts/*`, reached with `ctx.rest` (list, HTML, storage, send) |
| Bridge | `hermes_artifacts/assets/bridge.js` | `window.hermes`, talks only to its parent over a `MessagePort` |
| Browser viewer | `hermes_artifacts/server.py` | optional loopback viewer: a shell origin plus a separate content origin |
| CDP | `hermes_artifacts/desktop_cdp.py` | attach to or launch Hermes Desktop with `--remote-debugging-port` |

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

  Their license files sit next to them under `hermes_artifacts/types/`.
- **Background server:** none by default. The browser viewer (`127.0.0.1:8797` and `:8798`, loopback only,
  Host-header checked, token-protected API) starts only on `artifact_open where=browser` or
  `hermes artifacts serve`, and runs until that Hermes process exits.
- **Shell commands:** only `artifact_desktop_cdp` and `hermes artifacts cdp`. They list Hermes Desktop
  processes (`Get-Process` / `pgrep`) and start `Hermes` with `--remote-debugging-port` bound to
  `127.0.0.1`. With `restart=true` they also close it (`CloseMainWindow`, then `taskkill`/`pkill`). A
  debugging port lets any local process control the desktop renderer, so open it only while you use it.
- **Reads and writes:** only `<HERMES_HOME>/plugin-data/hermes-artifacts/` (deleting moves an artifact
  to `.trash/` there) and the files you pass to `artifact_publish`.
- **Credentials:** none.
- **Bridge tools:** `window.hermes.callTool` is off by default. In the browser viewer it is limited to the
  `bridge_tools` allowlist. In the desktop it is not available. Artifact HTML is untrusted content: only
  allowlist tools that are safe whatever the page asks for.

## Development

```bash
python -m unittest discover -s tests        # stdlib only
hermes plugins validate .                   # the catalog admission checks
python scripts/cdp_eval.py "document.title" # eval in a Hermes Desktop started with a CDP port (needs `websockets`)
```

`examples/` holds one artifact of each type (`counter` is a page that uses the bridge).
`python scripts/render_preview.py examples/dashboard dashboard [--vendor]` renders one into
`docs/preview/` to open in a browser.

## License

MIT
