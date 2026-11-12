# A design system from a code repository

The system mirrors the code: its names, its values, its files. Never invent or round.

1. **Ask once** (skip what the request says): repo/folder, which package or app, what to bring in
   (tokens, fonts, logos/icons, components), the system's name.
2. **Orient** with search, not by reading whole files: token files or CSS custom properties
   (`:root`, `.dark`, `[data-theme]`, `prefers-color-scheme`), a Tailwind/theme config, `@font-face`,
   logo and icon files, the component exports, any design docs.
3. **Tokens** → `tokens.json` (lists, as the guide says). Each theme selector is a `color.themes`
   entry, light/`:root` first. A color that is `var(--x)` becomes the alias `"{x}"`. `calc()`,
   `color-mix()` and other computed values: skip and list under "Not synced" in the README. Keep the
   code's token names; a usage note on each, from how the code uses it.
4. **Files, never through the conversation**: build the system in a scratch folder (`cp` fonts to
   `fonts/`, marks to `assets/Logos/`, icons to `assets/Icons/`) and publish the folder:
   `ha_publish type=design-system title="Acme" path="<folder>"`. No base64, no pasted file bodies.
5. **Components**: ask which. Default is read-only: `components/<Comp>/README.md` (what it is, props,
   what the consumer provides), `index.d.ts` copied or reduced from the source types, and a static
   `preview.html` in plain markup with the system's tokens. A runnable `bundle.js` only if the user
   agrees to running the project's install/build; then one classic script assigning
   `window.<Namespace>`, libraries as files in `components/lib/`.
6. **Record the source** in `tokens.json` `"meta": {"source": "code", "repo": "<path or url>",
   "ref": "<branch>@<short sha>", "paths": ["src/styles/tokens.css"], "synced": "<ISO time>"}` and
   `lastChange.via = "code · <repo>@<sha>"`.
7. The cover last; then tell the user what came from where, what was skipped, what remains.

## Syncing again

`meta.source == "code"`: read the current system first (people edit it on its page). Update values
that changed in the code; add new tokens; KEEP usage notes, README text, fonts and assets already
there. Tokens the code no longer defines: list them and ask before removing. Republish
`base=true` with only the changed files, `meta.ref`/`synced` and `lastChange` updated. Say in one
line what changed.
