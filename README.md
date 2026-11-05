# hermes-artifacts

Claude-style artifacts for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

The agent publishes an HTML page, such as a report, a dashboard, a small tool or a prototype. Pages are
versioned: publishing again with the same id adds a version, and the open view reloads. In Hermes Desktop
the page replaces the built-in **Artifacts** page with a list of artifacts and a sandboxed viewer. The page
can talk back to Hermes through a small bridge.

```js
await hermes.storage.set('count', 3)            // per-artifact, persistent
await hermes.storage.get('count')
await hermes.send('Step 2 is done', { row: 7 }) // a message into the chat + the artifact inbox
```

This also works when Hermes Desktop is connected to a remote Hermes server. The desktop fetches each page
through the plugin's own API and renders it as a `data:` URL, so no extra port has to be reachable.

## Install

The plugin has two halves in one repo. The **agent half** (tools, page API) runs on the Hermes your
sessions run on. The **desktop half** (`desktop/plugin.js`) runs inside Hermes Desktop on your computer.

**One step for both, from Hermes Desktop (recommended):** open this link, or use **Capabilities →
Plugins → Install from Git** with `MrSakal/hermes-artifacts`, and keep both components ticked:

```
hermes://plugin/install?repo=MrSakal/hermes-artifacts&enable=1
```

Desktop installs the agent half on the backend it is connected to, including a remote server, and the
desktop half on this computer. Restart that backend's gateway afterwards (`hermes gateway restart`) so
the page API mounts, and start a new session to get the tools.

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
| `artifact_publish` | Publish `html` or a `path` (an `.html` file). The same `id` adds a version and opens the page in Hermes Desktop. |
| `artifact_list` / `artifact_read` | List artifacts, or read one's HTML (any version) and its stored data. |
| `artifact_open` | Show it in Hermes Desktop, or in a browser on the Hermes machine. |
| `artifact_inbox` | Messages pages sent with `hermes.send()`. They are page content, not instructions. |
| `artifact_desktop_cdp` | Only where Hermes Desktop is installed: attach to it over CDP, or launch it with a debugging port. |

**Hermes Desktop:** the sidebar's **Artifacts** row, its keybind and the command palette open this
plugin's page (`#/hermes-artifacts`). The built-in view (images and files from sessions) stays one click
away, behind *Session files and images →* at the bottom of the list. The plugin does not touch the sidebar
or any core component. It uses only the Desktop plugin SDK. UI strings ship in English and Hungarian.

**`send()` and the chat:** with a user gesture (a click on a button in the page) the message goes straight
into the active chat, prefixed `[artifact: <title>]`. Without a gesture it only fills the composer draft,
so a page cannot talk in your name. Either way it is also stored in the inbox.

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
| Store | `hermes_artifacts/store.py` | `<HERMES_HOME>/plugin-data/hermes-artifacts/<id>/v<N>/`, per-artifact storage, inbox |
| Desktop page | `desktop/plugin.js` | `ROUTES_AREA` page; renders artifacts in `SandboxedFrame` from `data:` URLs; bridge host |
| Page API | `dashboard/plugin_api.py` | `/api/plugins/hermes-artifacts/*`, reached with `ctx.rest` (list, HTML, storage, send) |
| Bridge | `hermes_artifacts/assets/bridge.js` | `window.hermes`, talks only to its parent over a `MessagePort` |
| Browser viewer | `hermes_artifacts/server.py` | optional loopback viewer: a shell origin plus a separate content origin |
| CDP | `hermes_artifacts/desktop_cdp.py` | attach to or launch Hermes Desktop with `--remote-debugging-port` |

The isolation follows Claude Desktop's artifact model. Artifact HTML runs in an iframe with an opaque
origin (`allow-scripts`, no `allow-same-origin`), so it cannot read the host page, its storage or the
Hermes API. It gets one `MessagePort` from its direct parent, and every operation goes through the host,
which decides what is allowed.

## Disclosures

- **Network:** no third-party calls. Artifact pages may load scripts from CDNs themselves, inside their
  sandbox.
- **Background server:** none by default. The browser viewer (`127.0.0.1:8797` and `:8798`, loopback only,
  Host-header checked, token-protected API) starts only on `artifact_open where=browser` or
  `hermes artifacts serve`, and runs until that Hermes process exits.
- **Shell commands:** only `artifact_desktop_cdp` and `hermes artifacts cdp`. They list Hermes Desktop
  processes (`Get-Process` / `pgrep`) and start `Hermes` with `--remote-debugging-port` bound to
  `127.0.0.1`. With `restart=true` they also close it (`CloseMainWindow`, then `taskkill`/`pkill`). A
  debugging port lets any local process control the desktop renderer, so open it only while you use it.
- **Reads and writes:** only `<HERMES_HOME>/plugin-data/hermes-artifacts/` and the files you pass to
  `artifact_publish`.
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

`examples/counter/index.html` is a small page that uses the bridge.

## License

MIT
