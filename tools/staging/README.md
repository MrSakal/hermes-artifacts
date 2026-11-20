# Staging: test a plugin commit in the real Hermes Desktop

Staging is a second, throwaway Hermes on this Windows machine: its own Hermes home
(`C:\Sajat\hermes-staging\home`), its own gateway, and its own Hermes Desktop window, running beside
your normal Desktop. It runs the same Hermes code checkout (`%LOCALAPPDATA%\hermes\hermes-agent`) and
the same `Hermes.exe`, but none of your data. The staging root defaults to `C:\Sajat\hermes-staging`;
set `HERMES_STAGING_ROOT` to put it elsewhere (the paths below move with it).

## What it isolates

| Separate in staging | Shared with your live install |
| --- | --- |
| Hermes home: config, `.env`, `auth.json`, sessions/chats, memory, skills, cron | Hermes code checkout and `Hermes.exe` (read only; staging never updates it) |
| `plugins/` and `plugin-data/` (artifacts) | System git, network |
| Desktop plugins (`home\desktop-plugins`), copied from staging's own `plugins/` | User-level CLI state under `%USERPROFILE%` (e.g. other tools' logins) |
| Gateway process and its ports | |
| Desktop user data (`C:\Sajat\hermes-staging\userdata`): window state, settings, single-instance lock | |
| Python dependency environment (`home\installs\...`, built once on first run) | |

Staging has no model credentials until you add them (see "Once" below). The plugin's optional browser
viewer uses fixed ports (8797/8798); do not open it in staging and live at the same time.

## Once

1. Give staging a model (interactive, writes only to the staging home):

   ```powershell
   .\tools\staging\hermes.ps1 model
   ```

2. Turn the plugin's Desktop half on in the staging window: Capabilities > Plugins >
   hermes-artifacts switch On. A fresh Desktop profile keeps a package's Desktop half off until you
   do (Hermes' opt-in for unified packages); the choice is kept in the staging user data.

## The test flow

1. Push the branch: `git push origin my-branch`.
2. Install that exact commit and restart staging:

   ```powershell
   .\tools\staging\install.ps1 -Sha (git rev-parse origin/my-branch)
   ```

   `-Local` installs from this checkout instead, so an unpushed commit works too. Never install by
   the bare catalog name `hermes-artifacts`: that catalog entry is pinned to an old release.

   It ends with `verify.ps1`, which fails loudly unless both halves are that commit: the installed
   revision, `plugin.yaml` against the commit's `plugin/plugin.yaml`, the version the staging gateway
   loaded, the staging Desktop half (`home\desktop-plugins\hermes-artifacts`) byte-identical to the
   commit's `plugin/desktop/`, and, with the window open, the `PLUGIN_VERSION` the window loaded.

   About the Desktop half: in staging, Hermes copies it itself from the installed package
   (`home\plugins\hermes-artifacts\desktop\`) into `home\desktop-plugins\hermes-artifacts\` with a
   `.hermes-package.json` marker (Electron's reconcile, and the backend's
   `hermes_cli/desktop_plugin_halves.py`). Live needed a hand copy only because the live plugin folder
   is a junction to this repo (its `desktop/` sits under `plugin/`, so no reconcile finds it) and the
   live Desktop's primary backend is remote, whose halves never reach this machine. If the staging
   copy is stale, `verify.ps1` re-runs Hermes' reconcile for the staging home; it never writes to
   `%LOCALAPPDATA%\hermes\desktop-plugins` or `~\.hermes\desktop-plugins`.
3. Open the staging window: `.\tools\staging\start.ps1` (prints the debugging port, default 9333).
   The window looks like your normal one; tell it apart by the port (only staging answers on
   9333), its empty session list, and its process command line carrying
   `--user-data-dir=C:\Sajat\hermes-staging\userdata`.
4. Click through the change, or let a tester agent drive it over `http://127.0.0.1:9333`.
5. Found a problem: fix, commit, push, go to step 2 with the new SHA. Repeat.
6. Merge only when staging is clean. Then `.\tools\staging\stop.ps1`.

## Scripts

| Script | Does |
| --- | --- |
| `install.ps1 -Sha <40-char sha> [-Local]` | `hermes plugins install MrSakal/hermes-artifacts/plugin --ref <sha> --force --enable` into staging, restarts the staging gateway, restarts the staging window if it was open |
| `verify.ps1 -Sha <sha>` | The checks above on their own (uses `verify-window.mjs` over the CDP port) |
| `start.ps1 [-CdpPort 9333] [-BackendOnly]` | Starts the staging gateway, then the staging Desktop with a loopback debugging port |
| `stop.ps1 [-DesktopOnly]` | Stops only staging processes (matched by the staging user-data dir and the staging `gateway.pid`) |
| `hermes.ps1 <args>` | Any `hermes` command against the staging home |

## Remove staging completely

```powershell
.\tools\staging\stop.ps1
Remove-Item -Recurse -Force C:\Sajat\hermes-staging
```
