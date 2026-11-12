"""desktop/plugin.js parses and loads as a module (stub SDK), so a syntax slip can't ship again.

v0.6.0-v0.8.0 shipped with an unclosed template literal: the desktop half never loaded. Needs Node
(skipped without it).
"""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
NODE = shutil.which("node")

SDK_STUB = """
const atom = v => { let x = v; const ls = new Set(); return { get: () => x, set: n => { x = n; ls.forEach(f => f(n)) }, listen: f => (ls.add(f), () => ls.delete(f)) } }
export { atom }
export const host = { state: {}, request: async () => ({}), composer: {}, navigate() {} }
export const ROUTES_AREA = 'routes', SIDEBAR_NAV_AREA = 'nav', SIDEBAR_NAV_PREFS_AREA = 'prefs'
export const STATUSBAR_AREAS = { left: 'l', right: 'r' }
export const SandboxedFrame = () => null
export const usePluginI18n = () => k => k
export const useValue = a => a.get()
export default {}
"""
REACT_STUB = "export const useEffect = () => {}, useLayoutEffect = () => {}, useRef = () => ({}), useState = v => [v, () => {}]\nexport default {}\n"
JSX_STUB = "export const jsx = () => null, jsxs = () => null, Fragment = Symbol('Fragment')\n"


def stub_module(extra: str = "") -> Path:
    """plugin.js as a module on stubs in a temp folder (``extra`` is appended, e.g. test-only exports)."""
    d = Path(tempfile.mkdtemp(prefix="ha-desktop-"))
    src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
    src = (src.replace("from '@hermes/plugin-sdk'", "from './sdk.mjs'")
              .replace("from 'react/jsx-runtime'", "from './jsx.mjs'").replace("from 'react'", "from './react.mjs'"))
    (d / "plugin.mjs").write_text(src + extra, "utf-8")
    (d / "sdk.mjs").write_text(SDK_STUB, "utf-8")
    (d / "react.mjs").write_text(REACT_STUB, "utf-8")
    (d / "jsx.mjs").write_text(JSX_STUB, "utf-8")
    return d


def run_node(d: Path, body: str) -> dict:
    """Runs ``body`` (an async function body; ``m`` is the module) and returns the JSON it prints last."""
    script = (f"import('./plugin.mjs').then(async m => {{ {body} }}).then(() => process.exit(0))"
              ".catch(e => { console.error(String(e && e.stack || e)); process.exit(1) })")
    r = subprocess.run([NODE, "-e", script], cwd=d, capture_output=True, text=True, encoding="utf-8", timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout.strip().splitlines()[-1])


@unittest.skipIf(NODE is None, "node not installed")
class DesktopPluginTests(unittest.TestCase):
    def test_loads_and_exports_the_plugin(self):
        out = run_node(stub_module(), "console.log(JSON.stringify({id: m.default.id, register: typeof m.default.register}))")
        self.assertEqual(out, {"id": "hermes-artifacts", "register": "function"})


TRASH_KEYS = ["delConfirm", "delConfirmSub", "trashChip", "trashNote", "deletedAgo", "daysLeft", "restore", "restoreTip", "restored"]


@unittest.skipIf(NODE is None, "node not installed")
class GalleryTrashTests(unittest.TestCase):
    """The gallery's Trash: a chip with the count, rows with Restore, restore by the entry's folder name."""

    EXPORTS = "\nexport { STRINGS, restoreFromTrash, $trash, $trashOpen, $toast }\n"

    def test_the_gallery_has_a_trash_chip_only_while_the_trash_holds_something(self):
        src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
        gallery = src[src.index("function Gallery("):src.index("// ---------------------------------------------------------------- viewer")]
        self.assertRegex(gallery, r"trash\.length\s*\?\s*jsx\(Chip, \{ label: t\('trashChip', trash\.length\), active: inTrash")
        self.assertIn("jsx(TrashRow, { ctx, item: x }, x.name)", gallery)

    def test_restore_posts_the_entry_name_and_reloads_both_lists(self):
        body = """
        const calls = []
        const ctx = { storage: { get: () => null, set() {} }, rest: async (url, opts) => {
          calls.push({ url, opts: opts || null })
          if (url === '/trash') return { trash: [], days: 30 }
          if (url === '/artifacts') return { artifacts: [] }
          return { artifact: { id: 'x' } }
        } }
        m.$trashOpen.set(true)
        await m.restoreFromTrash(ctx, { name: 'x-1700000000-2', id: 'x', title: 'X' })
        console.log(JSON.stringify({ calls, open: m.$trashOpen.get(), toast: m.$toast.get() }))
        """
        out = run_node(stub_module(self.EXPORTS), body)
        post = [c for c in out["calls"] if c["url"] == "/trash/restore"]
        self.assertEqual(post, [{"url": "/trash/restore", "opts": {"method": "POST", "body": {"name": "x-1700000000-2"}}}])
        self.assertIn("/trash", [c["url"] for c in out["calls"]])
        self.assertIn("/artifacts", [c["url"] for c in out["calls"]])
        self.assertFalse(out["open"])  # the trash is empty now: back to the gallery
        self.assertEqual(out["toast"], "restored")  # the stub translate returns the key

    def test_a_refused_restore_shows_the_servers_message(self):
        body = """
        const ctx = { storage: { get: () => null, set() {} }, rest: async url => {
          if (url === '/trash/restore') throw new Error("an artifact 'x' exists again; delete or rename it first")
          if (url === '/trash') return { trash: [{ name: 'x-1', id: 'x', title: 'X', type: 'page', deleted_at: 1, days_left: 3 }], days: 30 }
          return { artifacts: [] }
        } }
        m.$trashOpen.set(true)
        await m.restoreFromTrash(ctx, { name: 'x-1', id: 'x', title: 'X' })
        console.log(JSON.stringify({ toast: m.$toast.get(), open: m.$trashOpen.get(), n: m.$trash.get().length }))
        """
        out = run_node(stub_module(self.EXPORTS), body)
        self.assertIn("exists again", out["toast"])
        self.assertEqual((out["open"], out["n"]), (True, 1))

    def test_every_trash_string_is_in_english_and_hungarian(self):
        body = f"""
        const keys = {json.dumps(TRASH_KEYS)}
        const call = v => (typeof v === 'function' ? v(2) : v)
        console.log(JSON.stringify(Object.fromEntries(['en', 'hu'].map(l =>
          [l, Object.fromEntries(keys.map(k => [k, m.STRINGS[l][k] === undefined ? null : call(m.STRINGS[l][k])]))]))))
        """
        out = run_node(stub_module(self.EXPORTS), body)
        for lang in ("en", "hu"):
            for k in TRASH_KEYS:
                self.assertTrue(out[lang][k], f"{lang}.{k} missing")
        self.assertNotEqual(out["en"]["restore"], out["hu"]["restore"])
        self.assertIn("Trash", out["en"]["delConfirmSub"])
        self.assertIn("Kukából", out["hu"]["delConfirmSub"])
        for lang in ("en", "hu"):
            for k in ("delConfirm", "delConfirmSub"):
                self.assertNotIn("hermes artifacts", out[lang][k])
                self.assertLessEqual(len(out[lang][k]), 34)  # fits the 240 px menu row


if __name__ == "__main__":
    unittest.main()


ALLOW_KEYS = ["allowTitle", "allowBody", "allowManual", "allowManaged", "allowCopy", "allowCopied", "allowCopyFailed"]
GOOD_CMD = "hermes config set plugins.entries.hermes-artifacts.mcp_allowlist '[bigquery, my-db]'"


@unittest.skipIf(NODE is None, "node not installed")
class AllowlistDialogTests(unittest.TestCase):
    """A denied MCP server: the host's own dialog shows the server's command, checked again, with Copy."""

    EXPORTS = "\nexport { STRINGS, allowCommand, showAllowHelp, copyCommand, $confirm, $toast, toolLabel }\n"

    def _copy(self, clipboard: str) -> dict:
        body = f"""
        Object.defineProperty(globalThis, 'navigator', {{ value: {{ clipboard: {clipboard} }}, configurable: true }})
        const ctx = {{ rest: async () => ({{ servers: ['my-db'], command: {json.dumps(GOOD_CMD)} }}) }}
        m.showAllowHelp(ctx, 'a1')
        await new Promise(r => setTimeout(r, 0))
        const ok = await m.copyCommand(m.$confirm.get().text.command, k => k)
        console.log(JSON.stringify({{ ok, toast: m.$toast.get(), failed: Boolean(m.$confirm.get().text.copyFailed),
          copied: globalThis.copied ?? null }}))
        """
        return run_node(stub_module(self.EXPORTS), body)

    def test_copy_shows_the_toast_when_it_works(self):
        out = self._copy("{ writeText: async s => { globalThis.copied = s } }")
        self.assertEqual(out, {"ok": True, "toast": "allowCopied", "failed": False, "copied": GOOD_CMD})

    def test_copy_says_so_when_the_clipboard_refuses_or_is_missing(self):
        for clip in ("{ writeText: async () => { throw new Error('denied') } }", "undefined"):
            out = self._copy(clip)
            self.assertEqual((out["ok"], out["toast"], out["failed"]), (False, None, True), clip)

    def test_the_host_refuses_a_tampered_command(self):
        bad = [GOOD_CMD + "; rm -rf ~", GOOD_CMD.replace("hermes-artifacts", "other"), GOOD_CMD.replace("my-db", "my db"),
               GOOD_CMD.replace("my-db", "$(id)"), GOOD_CMD.replace("'[", "["), GOOD_CMD + "\n", "", None, 42,
               "hermes config set plugins.entries.hermes-artifacts.mcp_allowlist '[]'"]
        body = f"console.log(JSON.stringify({{ good: m.allowCommand({json.dumps(GOOD_CMD)}), bad: {json.dumps(bad)}.map(m.allowCommand) }}))"
        out = run_node(stub_module(self.EXPORTS), body)
        self.assertEqual(out["good"], GOOD_CMD)
        self.assertEqual(out["bad"], [None] * len(bad))

    def test_the_dialog_takes_the_command_from_the_server_not_the_page(self):
        body = f"""
        const urls = []
        const reply = {{ servers: ['my-db'], command: {json.dumps(GOOD_CMD)}, managed: false }}
        const ctx = {{ rest: async url => {{ urls.push(url); return reply }} }}
        m.showAllowHelp(ctx, 'a1')
        await new Promise(r => setTimeout(r, 0))
        const first = m.$confirm.get()
        first.resolve(false); m.$confirm.set(null)
        reply.command = {json.dumps(GOOD_CMD + " && curl evil")}
        m.showAllowHelp(ctx, 'a1')
        await new Promise(r => setTimeout(r, 0))
        console.log(JSON.stringify({{ urls, first: first.text, second: m.$confirm.get().text }}))
        """
        out = run_node(stub_module(self.EXPORTS), body)
        self.assertEqual(out["urls"], ["/artifacts/a1/allowlist"] * 2)
        self.assertEqual((out["first"]["command"], out["first"]["servers"]), (GOOD_CMD, "my-db"))
        self.assertIsNone(out["second"]["command"])  # a command off the strict shape is not shown or copied
        src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
        branch = src[src.index("m.op === 'allowlist'"):]
        branch = branch[:branch.index("return reply({ ok: true")]
        self.assertNotIn("m.args", branch)  # nothing the page passes reaches the dialog

    def test_every_allowlist_string_is_in_english_and_hungarian(self):
        body = f"""
        const keys = {json.dumps(ALLOW_KEYS)}
        const call = v => (typeof v === 'function' ? v('x') : v)
        console.log(JSON.stringify(Object.fromEntries(['en', 'hu'].map(l =>
          [l, Object.fromEntries(keys.map(k => [k, m.STRINGS[l][k] === undefined ? null : call(m.STRINGS[l][k])]))]))))
        """
        out = run_node(stub_module(self.EXPORTS), body)
        for k in ALLOW_KEYS:
            self.assertTrue(out["en"][k] and out["hu"][k], k)
            self.assertNotEqual(out["en"][k], out["hu"][k], k)
        dash = (PLUGIN / "hermes_artifacts" / "types" / "dashboard" / "dashboard.js").read_text("utf-8")
        for k in ("deniedTitle:", "deniedBody:", "howAllow:"):
            self.assertEqual(dash.count(k), 2, k)  # en and hu

    def test_the_step_line_says_our_tools_without_the_prefix(self):
        names = ["ha_check", "ha_live_read", "ha_design_system_export", "ha_inbox", "ha_other", "mcp__db__run_query"]
        out = run_node(stub_module(self.EXPORTS), f"console.log(JSON.stringify({json.dumps(names)}.map(m.toolLabel)))")
        self.assertEqual(out, ["check", "live read", "design system export", "inbox", "ha other", "db run query"])


class DownloadTests(unittest.TestCase):
    def test_a_blob_export_is_saved_as_it_is(self):
        """Every binary export (xlsx, docx, pdf, pptx, png, zip, mp4) hands the host a Blob. Up to 0.14 the
        host JSON-stringified anything that was not a string or a buffer, so those files were a 2 byte "{}"."""
        src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
        branch = src[src.index("m.op === 'download'"):]
        branch = branch[:branch.index("return reply")]
        self.assertIn("instanceof Blob", branch)


VERSION_KEYS = ["versionRestart", "versionRestartGateway", "versionRestartServe", "versionRestartWorker",
                "versionRestartCli", "versionServerOlder", "versionDesktopOlder", "versionHide"]
# The keys that name the old and the installed version (args: loaded, disk[, role]).
RESTART_KEYS = ["versionRestart", "versionRestartGateway", "versionRestartServe", "versionRestartWorker", "versionRestartCli"]
# jsx that keeps the tree, so a component's output can be read.
TREE_JSX = "export const jsx = (type, props) => ({ type, props }), jsxs = jsx, Fragment = Symbol('Fragment')\n"


def stale(*procs, disk="0.16.1"):
    """A server field: these (role, version) processes live, ``disk`` installed."""
    ps = [{"role": r, "version": v} for r, v in procs]
    off = sorted(p["version"] for p in ps if p["version"] != disk)
    return {"loaded": off[0] if off else None, "disk": disk, "stale": bool(off), "processes": ps}


@unittest.skipIf(NODE is None, "node not installed")
class VersionNoticeTests(unittest.TestCase):
    """The gallery's one line when a server process runs older code than its files (named, with the
    restart that fits it), or the server and this Desktop half are different versions (update the older
    side); nothing when they agree."""

    EXPORTS = "\nexport { STRINGS, PLUGIN_VERSION, versionNotice, VersionNotice, $server, $versionClosed }\n"

    def notices(self, servers, mine="0.16.1"):
        return run_node(stub_module(self.EXPORTS),
                        f"console.log(JSON.stringify({json.dumps(servers)}.map(s => m.versionNotice(s, {json.dumps(mine)}))))")

    def test_each_case(self):
        cases = [
            (stale(("serve", "0.16.0"), ("gateway", "0.16.1")), "versionRestartServe", ["0.16.0", "0.16.1", "serve"]),
            (stale(("gateway", "0.16.0"), ("serve", "0.16.1")), "versionRestartGateway", ["0.16.0", "0.16.1", "gateway"]),
            (stale(("compute-host", "0.16.0")), "versionRestartWorker", ["0.16.0", "0.16.1", "compute-host"]),
            (stale(("plugin-host", "0.16.0")), "versionRestartWorker", ["0.16.0", "0.16.1", "plugin-host"]),
            (stale(("cli", "0.16.0")), "versionRestartCli", ["0.16.0", "0.16.1", "cli"]),
            (stale(("serve", "0.15.0"), ("gateway", "0.16.0")), "versionRestartMany", [2, "0.15.0", "0.16.1"]),
            # No roles (or none known): the general advice.
            ({"loaded": "0.16.0", "disk": "0.16.1", "stale": True}, "versionRestart", ["0.16.0", "0.16.1"]),
            ({"loaded": "0.16.0", "disk": "0.16.1", "stale": True, "processes": [{"role": "constructor", "version": "0.16.0"}]},
             "versionRestart", ["0.16.0", "0.16.1"]),
            # A restart comes first: only then is the version on disk what the server runs.
            (stale(("serve", "0.15.0"), disk="0.17.0"), "versionRestartServe", ["0.15.0", "0.17.0", "serve"]),
            ({"loaded": "0.15.2", "disk": "0.15.2", "stale": False}, "versionServerOlder", ["0.15.2", "0.16.1"]),
            ({"loaded": None, "disk": "0.9.0", "stale": False}, "versionServerOlder", ["0.9.0", "0.16.1"]),
            ({"loaded": "0.16.10", "disk": "0.16.10", "stale": False}, "versionDesktopOlder", ["0.16.1", "0.16.10"]),
        ]
        out = self.notices([c[0] for c in cases])
        for (server, key, args), got in zip(cases, out):
            self.assertEqual((got["key"], got["args"]), (key, args), server)
            self.assertEqual(got["id"], " ".join(str(a) for a in [key, *args]))

    def test_nothing_when_they_agree_or_nothing_is_known(self):
        servers = [stale(("serve", "0.16.1"), ("gateway", "0.16.1")), {"loaded": None, "disk": "0.16.1", "stale": False},
                   None, {}, "0.15", {"loaded": "<b>", "disk": "1 2", "stale": True}]
        self.assertEqual(self.notices(servers), [None] * len(servers))

    def test_shown_in_the_gallery_and_closed_for_the_session(self):
        d = stub_module(self.EXPORTS)
        (d / "jsx.mjs").write_text(TREE_JSX, "utf-8")
        body = f"""
        const out = {{}}
        const text = n => n && n.props.children[0].props.children
        out.equal = (m.$server.set({{ loaded: m.PLUGIN_VERSION, disk: m.PLUGIN_VERSION, stale: false }}), m.VersionNotice())
        m.$server.set({json.dumps(stale(("serve", "0.1.0"), disk="0.16.1"))})
        const shown = m.VersionNotice()
        out.shown = text(shown)
        out.role = shown.props.role
        shown.props.children[1].props.onClick()
        out.closed = m.VersionNotice()
        m.$server.set({{ loaded: '0.1.0', disk: '0.1.0', stale: false }})
        out.next = text(m.VersionNotice())
        console.log(JSON.stringify(out))
        """
        out = run_node(d, body)
        self.assertIsNone(out["equal"])
        self.assertEqual(out["shown"], "versionRestartServe")  # the stub's t() gives the key
        self.assertEqual(out["role"], "status")
        self.assertIsNone(out["closed"])
        self.assertEqual(out["next"], "versionServerOlder")  # another mismatch shows at once

    def test_the_list_poll_feeds_it(self):
        src = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
        load = src[src.index("async function loadList(ctx)"):]
        load = load[:load.index("\n}\n")]
        self.assertIn("$server.set(", load)
        self.assertIn("jsx(VersionNotice, {})", src)

    def test_strings_in_english_and_hungarian(self):
        body = f"""
        const keys = {json.dumps(VERSION_KEYS + ["versionRestartMany"])}
        const args = {{ versionRestartMany: [2, '0.15.0', '0.16.1'], versionRestartWorker: ['0.15.0', '0.16.1', 'compute-host'] }}
        const call = (k, v) => (typeof v === 'function' ? v(...(args[k] || ['0.15.0', '0.16.1'])) : v)
        console.log(JSON.stringify(Object.fromEntries(['en', 'hu'].map(l =>
          [l, Object.fromEntries(keys.map(k => [k, m.STRINGS[l][k] === undefined ? null : call(k, m.STRINGS[l][k])]))]))))
        """
        out = run_node(stub_module(self.EXPORTS), body)
        for k in VERSION_KEYS + ["versionRestartMany"]:
            self.assertTrue(out["en"][k] and out["hu"][k], k)
            self.assertNotEqual(out["en"][k], out["hu"][k], k)
        for lang in ("en", "hu"):
            for k in RESTART_KEYS + ["versionServerOlder", "versionDesktopOlder", "versionRestartMany"]:
                self.assertIn("0.15.0", out[lang][k], (lang, k))
                self.assertIn("0.16.1", out[lang][k], (lang, k))
            self.assertIn("hermes gateway restart", out[lang]["versionRestartGateway"])
            self.assertIn("hermes serve / dashboard", out[lang]["versionRestartServe"])
            self.assertIn("hermes gateway restart", out[lang]["versionRestartServe"])  # ...is not enough
            self.assertIn("compute-host", out[lang]["versionRestartWorker"])
            self.assertIn("2", out[lang]["versionRestartMany"])
            self.assertIn("hermes serve / dashboard", out[lang]["versionRestartMany"])
            self.assertIn("(hermes plugins update hermes-artifacts)", out[lang]["versionServerOlder"])
            self.assertNotIn("gateway", out[lang]["versionRestart"])
        self.assertEqual(out["en"]["versionRestartServe"],
                         "The Hermes backend this Desktop connects to (hermes serve / dashboard) still runs hermes-artifacts "
                         "0.15.0; 0.16.1 is installed. Restart that process on the server: hermes gateway restart alone doesn’t.")
