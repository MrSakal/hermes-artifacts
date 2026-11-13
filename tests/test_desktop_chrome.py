"""The Desktop half's chrome (plugin.js): popups that stay inside the window, the new comment's pin never
under its box, plain-sentence errors, the cleanup through ctx.onDispose, the clipboard through ctx.os,
the card previews (stored picture, the model's still, frames only near the window), the vendor and HTML
caches, the list's unchanged objects, the strings in English and Hungarian, and the web dashboard's
manifest. Pure functions run under node on the stub SDK; the look (Hermes' focus ring, radii, inks) is
checked in the source. Skipped without node.
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_desktop_plugin import NODE, PLUGIN, run_node, stub_module  # noqa: E402

SRC = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
EXPORTS = ("\nexport { STRINGS, fitPopup, placeCommentBox, PIN, COMMENT_W, errText, reuseSame, thumbKind, fetchVendor,"
           " copyText, $toast, filterCount, clearFilters, $types, $date, $pinnedOnly, $selected, C }\n")
NEW_KEYS = ["errStorage", "errDraining", "errOffline", "errGeneric", "errNoChat", "popInNoChat", "clearFilters",
            "clearFiltersTip", "noPreviewYet", "openComments"]


def section(start, end):
    i = SRC.index(start)
    return SRC[i:SRC.index(end, i)]


@unittest.skipIf(NODE is None, "node not installed")
class PopupFitTests(unittest.TestCase):
    """fitPopup: a menu laid out under its anchor flips above it, scrolls, or shifts sideways to stay seen."""

    def fit(self, pop, anchor, box, below=38):
        body = f"console.log(JSON.stringify(m.fitPopup({json.dumps(pop)}, {json.dumps(anchor)}, {json.dumps(box)}, {below})))"
        return run_node(stub_module(EXPORTS), body)

    def test_a_menu_with_room_below_stays_below(self):
        out = self.fit({"top": 138, "bottom": 338, "left": 100, "right": 340}, {"top": 100, "bottom": 132}, {"top": 0, "left": 0, "right": 1000, "bottom": 800})
        self.assertEqual(out, {"top": 38, "maxHeight": None, "dx": 0})

    def test_a_menu_near_the_bottom_flips_above_its_button(self):
        # The card menu of B1: 236 px tall under a button 140 px above the gallery's bottom edge.
        out = self.fit({"top": 778, "bottom": 1014, "left": 1093, "right": 1333}, {"top": 740, "bottom": 772}, {"top": 0, "left": 0, "right": 1582, "bottom": 872})
        self.assertEqual(out["top"], -6 - 236)
        self.assertIsNone(out["maxHeight"])
        bottom = 740 + out["top"] + 236
        self.assertLessEqual(bottom, 740)  # wholly above the button, nothing past the edge

    def test_a_menu_too_tall_for_either_side_scrolls_on_the_larger(self):
        out = self.fit({"top": 338, "bottom": 1338, "left": 0, "right": 200}, {"top": 300, "bottom": 332}, {"top": 0, "left": 0, "right": 800, "bottom": 600})
        self.assertGreater(out["maxHeight"], 0)
        self.assertLess(out["maxHeight"], 1000)
        self.assertEqual(out["top"], -6 - out["maxHeight"])  # more room above (286 against 254)
        self.assertGreaterEqual(300 + out["top"], 8)

    def test_a_menu_past_the_right_or_left_edge_is_shifted_back(self):
        out = self.fit({"top": 138, "bottom": 300, "left": 900, "right": 1160}, {"top": 100, "bottom": 132}, {"top": 0, "left": 0, "right": 1000, "bottom": 800})
        self.assertEqual(out["dx"], 1000 - 8 - 1160)
        out = self.fit({"top": 138, "bottom": 300, "left": -30, "right": 230}, {"top": 100, "bottom": 132}, {"top": 0, "left": 0, "right": 1000, "bottom": 800})
        self.assertEqual(out["dx"], 38)

    def test_every_popup_of_the_half_is_fitted(self):
        self.assertIn("useFit(ref, 38)", section("function PopMenu(", "function MenuRow("))
        self.assertIn("useFit(ref, top, 6)", section("function TileTip(", "function NewTile("))
        # PopMenu carries the card menu (with its confirm row), Filter, New, the tile's design systems, the
        # title menu and its Export submenu, the comment menu and the trash row's confirm.
        for name in ("function CardMenu(", "function FilterMenu(", "function NewMenu(", "function TileDsMenu(", "function TitleMenu("):
            start = SRC.index(name)
            self.assertIn("jsx(PopMenu,", SRC[start:start + 6000], name)
        self.assertIn("placeCommentBox(draft.rect, bw, bh, boxH)", section("function CommentPopover(", "function DockView("))


@unittest.skipIf(NODE is None, "node not installed")
class CommentPinTests(unittest.TestCase):
    """B4: the new comment's box never covers its pin, wherever the element is."""

    def test_the_box_never_overlaps_the_pin(self):
        body = """
        const out = []
        const cases = [[1200, 800, { x: 100, y: 200, w: 300, h: 40 }], [1200, 800, { x: 300, y: 150, w: 880, h: 60 }],
          [1200, 800, { x: 900, y: 700, w: 280, h: 60 }], [600, 400, { x: 0, y: 0, w: 600, h: 400 }], [1568, 860, { x: 549, y: 238, w: 690, h: 60 }]]
        for (const [bw, bh, rect] of cases) {
          const { pin, box } = m.placeCommentBox(rect, bw, bh, 170)
          const apart = box.x >= pin.x + m.PIN || box.x + m.COMMENT_W <= pin.x || box.y >= pin.y + m.PIN || box.y + 170 <= pin.y
          out.push({ apart, inside: box.x >= 0 && box.x + m.COMMENT_W <= bw && box.y >= 0 && box.y + 170 <= bh })
        }
        console.log(JSON.stringify(out))
        """
        out = run_node(stub_module(EXPORTS), body)
        for i, o in enumerate(out[:-2]):
            self.assertEqual(o, {"apart": True, "inside": True}, i)
        self.assertTrue(out[-1]["apart"])  # the reported doc paragraph: the box goes under the pin
        self.assertTrue(out[-1]["inside"])

    def test_the_pin_is_drawn_over_the_box(self):
        pop = section("function CommentPopover(", "function DockView(")
        self.assertIn("zIndex: 28, width: PIN", pop)
        self.assertIn("zIndex: 27, width: COMMENT_W", pop)


@unittest.skipIf(NODE is None, "node not installed")
class ErrorTextTests(unittest.TestCase):
    """A host or request failure reads as a sentence with what to do, never a bare code (N9)."""

    def test_codes_become_sentences(self):
        body = """
        const cases = ['storage_unavailable', new Error('503: {"detail":"storage_unavailable"}'), new Error('runtime_draining'),
          new TypeError('Failed to fetch'), new Error('invalid_params'), new Error('no_session'), '',
          new Error("an artifact 'x' exists again; delete or rename it first")]
        console.log(JSON.stringify(cases.map(c => m.errText(c))))
        """
        out = run_node(stub_module(EXPORTS), body)  # the stub translate returns the key
        self.assertEqual(out[:7], ["errStorage", "errStorage", "errDraining", "errOffline", "errGeneric", "errGeneric", "errGeneric"])
        self.assertEqual(out[7], "an artifact 'x' exists again; delete or rename it first")

    def test_every_error_shown_goes_through_it(self):
        self.assertNotIn("toast(String(e", SRC)
        self.assertNotIn("toast(String(err", SRC)
        self.assertNotIn("setErr(String(", SRC)
        self.assertIn("F.setErr(rec, errText(err))", SRC)
        self.assertNotIn("new Error('no session')", SRC)
        # a failed Chat beside the artifact says so (it was silent)
        self.assertIn("toast(errText(err), 'error')", section("async function openSplit(", "function expandDock("))


@unittest.skipIf(NODE is None, "node not installed")
class DisposeTests(unittest.TestCase):
    """register hands its cleanup to ctx.onDispose (the loader ignores what register returns)."""

    def test_the_cleanup_runs_through_on_dispose(self):
        sdk = """
        const atom = v => { let x = v; const ls = new Set(); const a = { get: () => x, set: n => { x = n; [...ls].forEach(f => f(n)) }, listen: f => (ls.add(f), () => ls.delete(f)), n: () => ls.size }; return a }
        export { atom }
        export const host = { state: { busy: atom(false), busyBySession: atom({}), focusedStoredSessionId: atom(null) }, request: async () => ({}), composer: {}, navigate() {} }
        export const ROUTES_AREA = 'routes', SIDEBAR_NAV_AREA = 'nav', SIDEBAR_NAV_PREFS_AREA = 'prefs'
        export const STATUSBAR_AREAS = { left: 'l', right: 'r' }
        export const SandboxedFrame = () => null
        export const usePluginI18n = () => k => k
        export const useValue = a => a.get()
        export default {}
        """
        d = stub_module(EXPORTS)
        (d / "sdk.mjs").write_text(sdk, "utf-8")
        body = """
        const listeners = new Map()
        globalThis.window = { location: { hash: '#/', replace() {} }, addEventListener() {}, removeEventListener() {}, navigation: null }
        globalThis.document = { addEventListener() {}, removeEventListener() {} }
        const disposers = []
        let timers = 0
        const ctx = { i18n: { register() {} }, register: () => () => {}, storage: { get: () => null, set() {} },
          rest: async () => ({ artifacts: [] }), onEvent: () => () => {},
          setInterval: () => (timers++, () => timers--), setTimeout: (f, ms) => { const i = setTimeout(f, ms); return () => clearTimeout(i) },
          addEventListener: (t, ty, fn) => () => {}, onDispose: fn => disposers.push(fn) }
        const ret = m.default.register(ctx)
        const before = m.$selected.n()
        disposers.forEach(f => f())
        const after = m.$selected.n()
        ret() // a second call does nothing
        console.log(JSON.stringify({ n: disposers.length, same: disposers[0] === ret, before, after, again: m.$selected.n() }))
        """
        out = run_node(d, body)
        self.assertEqual(out["n"], 1)
        self.assertTrue(out["same"])
        self.assertGreater(out["before"], 0)
        self.assertEqual(out["after"], 0)
        self.assertEqual(out["again"], 0)

    def test_the_cleanup_stops_what_the_host_does_not_track(self):
        reg = section("  register(ctx) {", "\n}\n")
        self.assertIn("ctx.onDispose(dispose)", reg)
        for what in ("stopTool", "stopRun", "...offTile", "...offs", "unwatchTheme"):
            self.assertIn(what, reg[reg.index("const dispose"):])


@unittest.skipIf(NODE is None, "node not installed")
class ClipboardTests(unittest.TestCase):
    """Copy link through the SDK's OS door (ctx.os.writeClipboard), the browser's as the fallback."""

    def test_copy_link_uses_ctx_os(self):
        body = """
        globalThis.window = { location: { hash: '#/', replace() {} }, addEventListener() {}, removeEventListener() {} }
        globalThis.document = { addEventListener() {}, removeEventListener() {} }
        const copied = []
        Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => { throw new Error('not this one') } } }, configurable: true })
        const ctx = { i18n: { register() {} }, register: () => () => {}, storage: { get: () => null, set() {} }, rest: async () => ({ artifacts: [] }),
          onEvent: () => () => {}, setInterval: () => () => {}, os: { writeClipboard: async t => (copied.push(t), true) } }
        m.default.register(ctx)
        await m.copyText('hermes://open/x')
        const a = { copied: [...copied], toast: m.$toast.get() }
        ctx.os.writeClipboard = async () => false // a shell without a clipboard: the browser's, here refused
        await m.copyText('hermes://open/y')
        console.log(JSON.stringify({ ...a, toast2: m.$toast.get() }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out["copied"], ["hermes://open/x"])
        self.assertEqual(out["toast"], "linkCopied")
        self.assertEqual(out["toast2"], "hermes://open/y")  # nothing took it: the link itself, to copy by hand
        self.assertNotIn("navigator.clipboard.writeText(cmd)", SRC)


@unittest.skipIf(NODE is None, "node not installed")
class GalleryPerfTests(unittest.TestCase):
    """P1, P5, P7, P10 and the poll."""

    def test_card_previews(self):
        body = """
        console.log(JSON.stringify([m.thumbKind({ type: 'model' }), m.thumbKind({ type: 'model', preview: true }), m.thumbKind({ type: 'model', preview: true }, true),
          m.thumbKind({ type: 'page' }), m.thumbKind({ type: 'doc', preview: true }), m.thumbKind({ type: 'doc', preview: true }, true)]))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out, ["still", "pic", "still", "frame", "pic", "frame"])
        thumb = section("function Thumb(", "function TypeBadge(")
        self.assertIn("setNear(e.isIntersecting)", thumb)  # in and out: a card that leaves unmounts its frame
        self.assertIn("setSrc(null) // and its frame: unmounted", thumb)
        self.assertIn("loaded.current?.()", thumb)  # its load slot back when it loads or leaves
        self.assertIn("thumbActive < THUMB_LOADS", SRC)

    def test_vendor_libraries_are_fetched_once(self):
        body = """
        let n = 0, fail = true
        const ctx = { rest: async p => { n++; if (p.includes('bad') && fail) { fail = false; throw new Error('x') } return { name: p } } }
        await m.fetchVendor(ctx, 'three.bundle.js'); await m.fetchVendor(ctx, 'three.bundle.js'); await m.fetchVendor(ctx, 'fflate.umd.js')
        const ok = n
        await m.fetchVendor(ctx, 'bad.js').catch(() => {}); await new Promise(r => setTimeout(r, 0)); await m.fetchVendor(ctx, 'bad.js')
        console.log(JSON.stringify({ ok, all: n }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out, {"ok": 2, "all": 4})  # a failed fetch is not kept
        self.assertIn("value: await fetchVendor(ctx,", SRC)

    def test_the_html_cache_is_dropped_only_by_reload(self):
        viewer = section("function Viewer(", "function Toast(")
        self.assertNotIn("if (nonce) htmlCache", viewer)
        self.assertIn("reloadAsked.delete(art.id) || LIVE_TYPES.has(art.type)", viewer)
        self.assertIn("reloadAsked.add(art.id); $nonce.set($nonce.get() + 1)", section("function TitleMenu(", "function TitleButton("))

    def test_an_unchanged_artifact_keeps_its_object(self):
        body = """
        const a = { id: 'a', v: 1 }, b = { id: 'b', v: 1 }
        const old = [a, b]
        const same = m.reuseSame([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], old)
        const one = m.reuseSame([{ id: 'a', v: 1 }, { id: 'b', v: 2 }], old)
        console.log(JSON.stringify({ same: same === old, keptA: one[0] === a, newB: one[1] !== b && one[1].v === 2, list: one !== old }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out, {"same": True, "keptA": True, "newB": True, "list": True})
        self.assertIn("const Card = memo(function Card({ ctx, art, sort })", SRC)
        self.assertIn("const ListRow = memo(function ListRow({ ctx, art, sort })", SRC)
        self.assertIn("jsx(Card, { ctx, art: a, sort }, a.id)", SRC)

    def test_no_list_poll_while_an_artifact_is_open_on_the_page(self):
        reg = section("  register(ctx) {", "\n}\n")
        self.assertIn("if (routeArtifact() === null || !listedOnce) refresh(ctx)", reg)
        page = section("function Page(", "// ---------------------------------------------------------------- entry")
        self.assertIn("refresh(ctx) // the list does not poll while an artifact is open", page)


@unittest.skipIf(NODE is None, "node not installed")
class LookTests(unittest.TestCase):
    """Hermes' own look: its radius scale, its focus ring, inks with 4.5:1, labels that say what they do."""

    def test_radius_scale_is_hermes(self):
        body = "console.log(JSON.stringify([m.C.rSm, m.C.rMd, m.C.rLg, m.C.rXl]))"
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out, ["calc(var(--radius-scalar, 0.2) * 0.5rem)", "calc(var(--radius-scalar, 0.2) * 0.625rem)",
                               "calc(var(--radius-scalar, 0.2) * 0.75rem)", "calc(var(--radius-scalar, 0.2) * 1rem)"])
        self.assertNotIn("'var(--radius-", SRC)  # --radius-sm etc. are never on :root (Tailwind @theme inline tokens)
        self.assertIn("radiusSm: px(C.rSm)", SRC)
        self.assertIn("const ICON_BTN = `rounded-[4px] ${FOCUS}`", SRC)

    def test_focus_ring_on_every_control(self):
        self.assertIn("const FOCUS = 'focus-visible:outline-hidden focus-visible:ring-[0.1875rem] focus-visible:ring-ring/50'", SRC)
        for name, end, cls in (("function IconButton(", "function Chip(", "className: label ? TEXT_BTN : ICON_BTN"),
                               ("function Chip(", "// ---------------------------------------------------------------- footer", "className: TEXT_BTN"),
                               ("function RowButton(", "function FloatingFooter(", "className: FOCUS"),
                               ("function OverlayBtn(", "async function patchMeta(", "className: `${ICON_BTN} ${SHADOW}`"),
                               ("function MenuRow(", "function fmtSize(", "className: MENU_ROW"),
                               ("function NewTile(", "/** A small round button", "className: TEXT_BTN")):
            self.assertIn(cls, section(name, end), name)
        card = section("const Card = memo(", "const ListRow = memo(")
        self.assertIn("className: FOCUS", card)
        self.assertNotIn("outline: 'none'", card)
        # an inline box-shadow would hide the ring: the overlay buttons take Hermes' shadow class instead
        self.assertNotIn("boxShadow", section("function OverlayBtn(", "async function patchMeta("))
        # the tile's name keeps room inside its ring
        self.assertIn("padding: 4, margin: -4", section("function NewTile(", "/** A small round button"))

    def test_quiet_text_meets_four_and_a_half(self):
        self.assertIn("text3: 'var(--conversation-scaffold-text, var(--ui-text-secondary))'", SRC)
        self.assertIn("color: hover ? C.fg : C.text2", section("function RowButton(", "function FloatingFooter("))
        self.assertEqual(SRC.count("color: C.text2 }, children: t('noMatch')"), 2)
        self.assertNotIn("color: C.text4 }, children: ago(", SRC)

    def test_labels_match_what_they_do(self):
        panel = section("function CommentsPanel(", "function Viewer(")
        self.assertIn("jsx(IconButton, { icon: 'close', title: t('close'), onClick: () => ($panel.set(false)", panel)
        self.assertNotIn("title: t('cancel')", panel)
        chat = section("function FloatingChat(", "// ---------------------------------------------------------------- header")
        self.assertNotIn("icon: 'expand'", chat)  # the header's Expand is another thing
        self.assertIn("jsx(IconButton, { icon: 'beside', title: t('popInNoChat'), disabled: true })", chat)
        menu = section("function FilterMenu(", "function NewMenu(")
        self.assertIn("{ sort: 'sortBy', type: 'typeF', date: 'dateOpened' }[view]", menu)

    def test_an_active_filter_shows_and_resets(self):
        body = """
        m.$types.set(['doc']); m.$date.set('7d'); m.$pinnedOnly.set(true)
        const n = m.filterCount(m.$types.get(), m.$date.get(), m.$pinnedOnly.get())
        m.clearFilters()
        console.log(JSON.stringify({ n, after: m.filterCount(m.$types.get(), m.$date.get(), m.$pinnedOnly.get()) }))
        """
        self.assertEqual(run_node(stub_module(EXPORTS), body), {"n": 3, "after": 0})
        gallery = section("function Gallery(", "// ---------------------------------------------------------------- viewer")
        self.assertIn("label: t('clearFilters', filterCount(types, date, pinnedOnly))", gallery)
        self.assertIn("pressed: filtered", gallery)
        self.assertIn("scrollbarGutter: 'stable'", gallery)  # N10: no sideways shift

    def test_new_strings_in_english_and_hungarian(self):
        body = f"""
        const keys = {json.dumps(NEW_KEYS)}
        const call = v => (typeof v === 'function' ? v(2) : v)
        console.log(JSON.stringify(Object.fromEntries(['en', 'hu'].map(l => [l, Object.fromEntries(keys.map(k => [k, m.STRINGS[l][k] === undefined ? null : call(m.STRINGS[l][k])]))]))))
        """
        out = run_node(stub_module(EXPORTS), body)
        for k in NEW_KEYS:
            self.assertTrue(out["en"][k], f"en.{k}")
            self.assertTrue(out["hu"][k], f"hu.{k}")
            self.assertNotEqual(out["en"][k], out["hu"][k], k)
        for k in ("errStorage", "errDraining", "errOffline", "errGeneric"):
            self.assertNotIn("_", out["en"][k])  # no code in the sentence


class DashboardManifestTests(unittest.TestCase):
    """The web dashboard loads a bundle for every plugin manifest: a hidden tab and a stub entry, no 404."""

    def test_hidden_tab_and_entry(self):
        d = PLUGIN / "dashboard"
        m = json.loads((d / "manifest.json").read_text("utf-8"))
        self.assertEqual(m["tab"], {"path": "/hermes-artifacts", "hidden": True})
        self.assertEqual(m["entry"], "dist/index.js")
        self.assertEqual(m["api"], "plugin_api.py")
        js = (d / m["entry"]).read_text("utf-8")
        self.assertIn('plugins.register("hermes-artifacts", ArtifactsHere)', js)


if __name__ == "__main__":
    unittest.main()
