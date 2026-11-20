# hermes-artifacts

Artifacts plugin for Hermes Agent (`plugin/`) with a Python backend and a Hermes Desktop UI half.

## Non-Discoverable Invariants

- **Install boundary:** Only `plugin/` ships to Hermes installs (stdlib-only Python, zero third-party runtime dependencies). `tests/`, `examples/`, `tools/`, and repo-root Claude configuration stay out of installs.
- **4-way version parity:** Any version bump must update all four files identically:
  - `plugin/plugin.yaml` (`version:`)
  - `plugin/dashboard/manifest.json` (`"version":`)
  - `plugin/hermes_artifacts/running.py` (`VERSION =`)
  - `plugin/desktop/plugin.js` (`const PLUGIN_VERSION =`)
- **Branding boundary:** `tests/test_branding.py` enforces Hermes branding across `plugin/` and `README.md`, and on `0.20.0+` also rejects `claude` in comments and docstrings across `plugin/` and `tests/` (except its explicit allowlists). Keep Claude/Anthropic names and terracotta/warm-paper hex hues out of those files.
- **Desktop ESM, SDK-only & vendored bundles:**
  - `plugin/desktop/plugin.js` is plain uncompiled ESM using only `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime` with inline styles on Hermes theme CSS variables; catalog rule 8 forbids raw `window.hermesDesktop` preload bridge access.
  - Type pages' chrome (`plugin/hermes_artifacts/types/`) uses Hermes Desktop's 16-unit filled codicons shipped once in `types/_kit/kit.js` and kit radii tokens (`tests/test_hermes_look.py`).
  - `plugin/hermes_artifacts/types/vendor/pptxgen.bundle.js` is unmodified upstream PptxGenJS 3.12.0; line 2 contains invisible Unicode explicitly allowlisted in `.github/workflows/ci.yml` — leave it unmodified.
  - `plugin/hermes_artifacts/types/vendor/three.bundle.js` is rebuilt byte-for-byte via `tools/three-bundle/` (`npm ci && npm run build`).

## Staging vs. Live Hermes

- Test plugin commits against the isolated staging home (`C:\Sajat\hermes-staging`) via `tools/staging/`:
  - Install a commit (or local checkout): `.\tools\staging\install.ps1 -Sha <40-char-sha> [-Local]`
  - Launch staging Desktop (CDP default `9333`): `.\tools\staging\start.ps1`
  - Verify both halves match the commit: `.\tools\staging\verify.ps1 -Sha <40-char-sha>`
  - Stop staging safely: `.\tools\staging\stop.ps1` (targets staging `gateway.pid`; `hermes gateway stop/restart` scans processes and collides with the live gateway's argv).
  - Run CLI commands against staging: `.\tools\staging\hermes.ps1 <args>`
- Install from `MrSakal/hermes-artifacts/plugin` or `-Local`, not the bare catalog name `hermes-artifacts` (pinned to an old release).

## Verification

- Quick checkpoint (version parity + CI JS syntax + fast targeted tests, `HA_NO_BROWSER=1`, ~6s):
  `node .claude/hooks/verify-checkpoint.mjs --fast --all`
- Full CI-equivalent checkpoint (all non-browser unit tests, `HA_NO_BROWSER=1`):
  `node .claude/hooks/verify-checkpoint.mjs --all`
- Full pre-release browser-driven suite (drives real headless Chrome, ~1 h):
  `node .claude/hooks/verify-checkpoint.mjs --all --with-browser`
- Direct CI unit tests (stdlib only; on Windows use real Python 3.11+ rather than the Microsoft Store `python.exe` stub):
  `HA_NO_BROWSER=1 python -m unittest discover -s tests`
- Catalog admission checks (when `hermes` CLI is available):
  `hermes plugins validate plugin`
