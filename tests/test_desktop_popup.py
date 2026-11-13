"""The chat's two layouts (plugin.js): docked (the chat with the artifact beside it) and popup (the artifact
over the chat's area, the chat floating over it), from inside the chat as on the full page.

The fake Hermes Desktop of test_desktop_states (the same invariants after every step) plays: Pop out chat
beside the chat moves the tile over the chat with its chat floating over it, on the chat's own route; the
expanded header switches Show chat | Pop out chat (pressed while it floats), the toggle and Esc close only the
floating chat; the layout picked is remembered for the window (the titlebar close and reopen, another
artifact by its card, another chat, a being-made placeholder and its publish open in it), Show chat and the
floating chat's own button go back to docked; the full page's Chat | Pop out chat set it too; an artifact
with no chat gets the floating chat that starts one; the switch is there for every type, beside the chat and
on the page. Then the strings in English and Hungarian and where the floating chat sits. Skipped without
node.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_desktop_plugin import run_node, stub_module  # noqa: E402
from test_desktop_states import JSX, NODE, PLUGIN, REACT, RUN, SDK  # noqa: E402

HARNESS = RUN.split("// ---------------------------------------------------------------- scenarios")[0]

SCENARIOS = r"""
// ---------------------------------------------------------------- the popup layout
const A = { id: 'a1', title: 'Alpha', type: 'page', session: 'chatA', updated: 2, version: 1 }
const A2 = { id: 'a2', title: 'Alpha two', type: 'doc', session: 'chatA', updated: 1, version: 1 }
const B = { id: 'b1', title: 'Beta', type: 'sheet', session: 'chatB', updated: 3, version: 1 }
const N = { id: 'n1', title: 'Loose', type: 'page', session: null, updated: 0, version: 1 } // made in no chat
list = [A, A2, B, N]
routerNav('/chatA')
let stop = mod.default.register(ctx)
openGate()
await settle()

const card = id => ({ type: I.ChatArtifactCard, props: { ctx, attrs: { id } } })
const making = (session, phase, extra = {}) => emit('plugin.hermes-artifacts.making', { payload: { session, phase, started: 1, ...extra } })
const opened = art => emit('plugin.hermes-artifacts.open', { payload: { id: art.id, title: art.title, type: art.type, version: 1, session: art.session } })
const titles = el => buttons(el).map(b => b.props.title)
const pop = el => buttons(el).find(b => b.props.title === 'popOut')
function find(el, name) {
  if (el == null || typeof el !== 'object') return null
  if (Array.isArray(el)) { for (const e of el) { const f = find(e, name); if (f) return f } return null }
  if (typeof el.type === 'function') { if (el.type.name === name) return el; return SKIP.has(el.type.name) ? null : find(el.type(el.props || {}), name) }
  return find(el.props?.children, name)
}
// The switch: one group, labelled, holding its buttons in order.
const group = el => expand(el).find(e => e.props?.role === 'group' && e.props['aria-label'] === 'chatModes')
const groupTitles = el => { const g = group(el); return g ? buttons(g).map(b => b.props.title) : null }
const floating = (el = tileEl()) => find(el, 'FloatingChat')
const want = (cond, msg) => { if (!cond) throw new Error(msg) }
const mode = () => `${I.$chatMode.get()}/${I.$dockFloat.get()}`
const POP = { split: true, expanded: true, page: false, lit: 'chat:chatA', route: '#/chatA', closed: false }

await S('beside the chat: Pop out chat and expand, no Show chat', () => {
  const ts = titles(tileEl())
  want(ts.filter(x => x === 'popOut').length === 1 && ts.includes('expand') && !ts.includes('showChat') && !ts.includes('chat'), 'header ' + ts.join(' '))
  want(JSON.stringify(groupTitles(tileEl())) === '["popOut"]', 'switch ' + groupTitles(tileEl()))
  const p = pop(tileEl())
  want(p.props['aria-pressed'] === false && 'data-ha-popout' in p.props, 'popOut props ' + JSON.stringify(Object.keys(p.props)))
  want(!floating() && mode() === 'docked/false', 'mode ' + mode())
}, { split: true, expanded: false, selected: 'a1' })

await S('Pop out chat beside the chat: the artifact over the chat, its chat floating over it', () => click(tileEl(), b => b.props.title === 'popOut', 'popOut'), { ...POP, selected: 'a1' })
await S('the popup follows the artifact and its chat', () => {
  want(mode() === 'popup/true', 'mode ' + mode())
  const f = floating()
  want(f && f.props.art?.id === 'a1' && f.props.art.session === 'chatA' && !f.props.sid, 'floating ' + JSON.stringify(f?.props?.art))
}, POP)
await S('its header: Show chat | Pop out chat (pressed) as one switch, no expand', () => {
  want(JSON.stringify(groupTitles(tileEl())) === '["showChat","popOut"]', 'switch ' + groupTitles(tileEl()))
  const ts = titles(tileEl())
  want(!ts.includes('expand') && ts.filter(x => x === 'showChat').length === 1 && ts.filter(x => x === 'popOut').length === 1, 'header ' + ts.join(' '))
  want(pop(tileEl()).props['aria-pressed'] === true, 'not pressed')
}, POP)
await S('Pop out chat again closes only the floating chat', async () => {
  click(tileEl(), b => b.props.title === 'popOut', 'popOut'); await settle()
  want(mode() === 'popup/false' && !floating() && pop(tileEl()).props['aria-pressed'] === false, 'mode ' + mode())
}, POP)
await S('and opens it again', async () => {
  click(tileEl(), b => b.props.title === 'popOut', 'popOut'); await settle()
  want(mode() === 'popup/true' && floating(), 'mode ' + mode())
}, POP)
await S('Esc in the floating chat closes it; the layout stays', async () => {
  const el = I.FloatingChat(floating().props)
  want(el.props.role === 'dialog' && el.props['aria-label'] === 'popupLabel', 'dialog ' + el.props.role)
  const box = expand(el).find(e => e.type === 'textarea')
  want(box && box.props.ref && box.props['aria-label'] === 'describeChange', 'composer')
  el.props.onKeyDown({ key: 'a', stopPropagation() {}, nativeEvent: {} }); await settle()
  want(I.$dockFloat.get(), 'another key closed it')
  let stopped = false
  el.props.onKeyDown({ key: 'Escape', stopPropagation() { stopped = true }, nativeEvent: {} }); await settle()
  want(mode() === 'popup/false' && stopped, 'mode ' + mode())
}, POP)
await S('its x the same', async () => {
  click(tileEl(), b => b.props.title === 'popOut', 'popOut'); await settle()
  click(I.FloatingChat(floating().props), b => b.props.title === 'close', 'close'); await settle()
  want(mode() === 'popup/false', 'mode ' + mode())
}, POP)
await S('closed with the titlebar and opened again: the popup layout, remembered', async () => {
  click(titlebar().render(), () => true, 'titlebar'); await settle()
  want(I.$chat.get() === 'off', 'not closed')
  click(titlebar().render(), () => true, 'titlebar'); await settle()
  want(mode() === 'popup/true' && floating()?.props.art.id === 'a1', 'mode ' + mode())
}, { ...POP, selected: 'a1' })
await S('another artifact of the chat by its card: the same layout, the popup on that one', async () => {
  click(card('a2'), () => true, 'card'); await settle()
  want(mode() === 'popup/true' && floating()?.props.art.id === 'a2', 'floating ' + floating()?.props.art.id)
}, { ...POP, selected: 'a2' })
await S('the card of the one shown: still over the chat with its chat', async () => {
  I.$dockFloat.set(false)
  click(card('a2'), () => true, 'card'); await settle()
  want(mode() === 'popup/true', 'mode ' + mode())
}, { ...POP, selected: 'a2' })
await S('another chat in front: its artifact in the popup layout, the popup on its own chat', () => routerNav('/chatB'), { split: true, expanded: true, selected: 'b1', lit: 'chat:chatB', route: '#/chatB' })
await S('that popup is chat B\'s', () => want(floating()?.props.art.session === 'chatB' && mode() === 'popup/true', 'floating ' + JSON.stringify(floating()?.props.art)), { split: true, expanded: true })
await S('a new chat making a dashboard: the placeholder over the chat, the popup on that chat', async () => {
  routerNav('/chatL'); await settle()
  making('chatL', 'guide', { type: 'dashboard' })
}, { split: true, making: 'chatL', expanded: true, lit: 'chat:chatL', titlebarOpen: true })
await S('the placeholder\'s header has the same switch, its popup the chat being made in', () => {
  want(JSON.stringify(groupTitles(tileEl())) === '["showChat","popOut"]', 'switch ' + groupTitles(tileEl()))
  const f = floating()
  want(f && f.props.sid === 'chatL' && !f.props.art && mode() === 'popup/true', 'floating ' + JSON.stringify(f?.props?.sid))
}, { split: true, making: 'chatL', expanded: true })
const L1 = { id: 'l1', title: 'Board', type: 'dashboard', session: 'chatL', updated: 9, version: 1 }
await S('published: the same tile, still over the chat, the popup on the artifact', async () => {
  log.length = 0
  list = [...list, L1]
  making('chatL', 'done', { id: 'l1', title: 'Board', type: 'dashboard' })
  opened(L1)
}, { split: true, making: null, expanded: true, selected: 'l1', reopens: 1 })
await S('its popup follows the artifact now', () => want(floating()?.props.art.id === 'l1' && floating().props.art.session === 'chatL', 'floating'), { split: true, expanded: true })
await S('Show chat: beside, docked remembered', async () => {
  click(tileEl(), b => b.props.title === 'showChat', 'showChat'); await settle()
  want(mode() === 'docked/false' && !floating(), 'mode ' + mode())
}, { split: true, expanded: false, selected: 'l1', lit: 'chat:chatL' })
await S('closed and opened again: beside', async () => {
  click(titlebar().render(), () => true, 'titlebar'); await settle()
  click(titlebar().render(), () => true, 'titlebar')
}, { split: true, expanded: false, selected: 'l1' })
await S('a placeholder beside the chat offers Pop out chat too, and it moves over the chat', async () => {
  routerNav('/chatM'); await settle()
  making('chatM', 'guide', { type: 'slides' }); await settle()
  want(JSON.stringify(groupTitles(tileEl())) === '["popOut"]', 'switch ' + groupTitles(tileEl()))
  click(tileEl(), b => b.props.title === 'popOut', 'popOut'); await settle()
  want(mode() === 'popup/true' && floating()?.props.sid === 'chatM', 'mode ' + mode())
}, { split: true, making: 'chatM', expanded: true, lit: 'chat:chatM' })
await S('the floating chat\'s own beside button: docked again', async () => {
  making('chatM', 'ended'); await settle()
  routerNav('/chatA'); await settle()
  want(mode() === 'popup/true', 'mode ' + mode())
  floating().props.onDock(); await settle()
  want(mode() === 'docked/false', 'mode ' + mode())
}, { split: true, expanded: false, lit: 'chat:chatA', selected: 'a1' })

// ---------------------------------------------------------------- the full page
await S('gallery, then an artifact: Chat | Pop out chat as one switch', async () => {
  routerNav(PAGE); await settle(); I.openOnPage(ctx, 'b1'); await settle()
  want(JSON.stringify(groupTitles(routeEl())) === '["chat","popOut"]', 'switch ' + groupTitles(routeEl()))
  want(!titles(routeEl()).includes('showChat') && !titles(routeEl()).includes('expand'), 'page header ' + titles(routeEl()).join(' '))
}, { page: true, selected: 'b1', split: false })
await S('Pop out chat on the page: its chat floating over it, the popup layout picked', async () => {
  click(routeEl(), b => b.props.title === 'popOut', 'popOut'); await settle()
  want(I.$chat.get() === 'float' && I.$chatMode.get() === 'popup', 'chat ' + I.$chat.get())
  want(floating(routeEl())?.props.art.id === 'b1' && pop(routeEl()).props['aria-pressed'] === true, 'floating on the page')
}, { page: true, selected: 'b1', split: false })
await S('Esc closes it there too', async () => {
  I.FloatingChat(floating(routeEl()).props).props.onKeyDown({ key: 'Escape', stopPropagation() {}, nativeEvent: {} }); await settle()
  want(I.$chat.get() === 'off' && !floating(routeEl()), 'chat ' + I.$chat.get())
}, { page: true, selected: 'b1' })
await S('an artifact made in no chat: the floating chat opens and will start one', async () => {
  I.openOnPage(ctx, 'n1'); await settle()
  click(routeEl(), b => b.props.title === 'popOut', 'popOut'); await settle()
  want(floating(routeEl())?.props.art.id === 'n1' && (await I.chatState(N)) === 'none', 'no-chat popup')
  I.$chat.set('off')
}, { page: true, selected: 'n1' })
await S('with the popup layout picked, the page\'s Chat: beside its chat, docked picked', async () => {
  I.$chatMode.set('popup')
  I.openOnPage(ctx, 'b1'); await settle()
  click(routeEl(), b => b.props.title === 'chat', 'Chat'); await settle()
  want(mode() === 'docked/false', 'mode ' + mode())
}, { split: true, expanded: false, page: false, selected: 'b1', lit: 'chat:chatB' })

// ---------------------------------------------------------------- every type, every way in
const TYPES = ['page', 'doc', 'sheet', 'board', 'dashboard', 'slides', 'design', 'model', 'motion', 'design-system']
const missing = []
await S('every type: the switch beside its chat, over it, and on the page', async () => {
  for (const ty of TYPES) {
    const art = { id: `t-${ty}`, title: `T ${ty}`, type: ty, session: `chat-${ty}`, updated: 1, version: 1 }
    list = [...list, art]; await I.refresh(ctx)
    I.$chatMode.set('docked')
    routerNav(`/chat-${ty}`); await settle() // entering the chat
    if (I.$selected.get() !== art.id || JSON.stringify(groupTitles(tileEl())) !== '["popOut"]') missing.push(`${ty}: beside`)
    click(tileEl(), b => b.props.title === 'popOut', 'popOut'); await settle()
    if (JSON.stringify(groupTitles(tileEl())) !== '["showChat","popOut"]' || floating()?.props.art.id !== art.id) missing.push(`${ty}: popup`)
    click(titlebar().render(), () => true, 'titlebar'); await settle()
    click(card(art.id), () => true, 'card'); await settle() // its card in the chat: the layout picked
    if (tilePos() !== 'center' || floating()?.props.art.id !== art.id) missing.push(`${ty}: card`)
    routerNav(PAGE); await settle(); I.openOnPage(ctx, art.id); await settle() // the gallery
    if (JSON.stringify(groupTitles(routeEl())) !== '["chat","popOut"]') missing.push(`${ty}: page`)
  }
  want(!missing.length, missing.join('; '))
}, { page: true })

console.log(JSON.stringify({ fails, log: [] }, null, 1))
process.exit(0)
"""

EXPORTS = ("\nexport const __test = { $chat, $selected, current, openArtifact, openOnPage, closeArtifact, refresh, toast, $toast, Toast,"
           " saveFile, copyCommand, themePorts, $makings, $dockMaking, $dockPos, ChatArtifactCard, $chatMode, $dockFloat,"
           " FloatingChat, chatState }\n")


def module() -> Path:
    d = Path(tempfile.mkdtemp(prefix="ha-popup-"))
    src = (PLUGIN.read_text("utf-8").replace("from '@hermes/plugin-sdk'", "from './sdk.mjs'")
           .replace("from 'react/jsx-runtime'", "from './jsx.mjs'").replace("from 'react'", "from './react.mjs'"))
    (d / "plugin.mjs").write_text(src + EXPORTS, "utf-8")
    (d / "sdk.mjs").write_text(SDK, "utf-8")
    (d / "react.mjs").write_text(REACT, "utf-8")
    (d / "jsx.mjs").write_text(JSX, "utf-8")
    return d


@unittest.skipIf(NODE is None, "node not installed")
class PopupLayoutTests(unittest.TestCase):
    def test_the_two_layouts_from_the_chat_and_the_page(self):
        d = module()
        (d / "run.mjs").write_text(HARNESS + SCENARIOS, "utf-8")
        r = subprocess.run([NODE, "run.mjs"], cwd=d, capture_output=True, text=True, encoding="utf-8", timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout[r.stdout.index("{"):])
        self.assertEqual(out["fails"], [], "\n".join(out["fails"]))
        shutil.rmtree(d, ignore_errors=True)

    def test_strings_in_english_and_hungarian(self):
        keys = ["chat", "showChat", "popOut", "popIn", "chatModes", "popupLabel", "describeChange", "noChat"]
        out = run_node(stub_module("\nexport { STRINGS }\n"), f"""
        const keys = {json.dumps(keys)}
        console.log(JSON.stringify(Object.fromEntries(['en', 'hu'].map(l => [l, Object.fromEntries(keys.map(k => [k, m.STRINGS[l][k] ?? null]))]))))
        """)
        en, hu = out["en"], out["hu"]
        self.assertEqual((en["chat"], en["showChat"], en["popOut"], en["popIn"]), ("Chat", "Show chat", "Pop out chat", "Chat beside the artifact"))
        self.assertEqual((en["chatModes"], en["popupLabel"]), ("Where the chat shows", "Chat with Hermes"))
        self.assertEqual((hu["showChat"], hu["popOut"], hu["popIn"]), ("Chat megjelenítése", "Chat lebegő ablakban", "Chat az artifact mellett"))
        self.assertEqual((hu["chatModes"], hu["popupLabel"]), ("Hol látszik a chat", "Chat a Hermesszel"))
        for k in en:
            self.assertTrue(en[k] and hu[k], k)
            if k != "chat":
                self.assertNotEqual(en[k], hu[k], k)

    def test_where_the_floating_chat_sits(self):
        src = PLUGIN.read_text("utf-8").replace("\r\n", "\n")
        viewer = src[src.index("function Viewer("):src.index("function Toast(")]
        # In the stage, under the header and its bands; mounted only while open (a closed one takes no click).
        self.assertLess(viewer.index("ref: stage"), viewer.index("jsx(FloatingChat"))
        self.assertLess(viewer.index("jsx(FrameBand"), viewer.index("ref: stage"))
        self.assertIn("docked && expanded && dockFloat", viewer)
        making = src[src.index("function MakingView("):src.index("function MakingLine(")]
        self.assertLess(making.index("jsx(MakingLine"), making.index("jsx(FloatingChat"))
        chat = src[src.index("function FloatingChat("):src.index("// ---------------------------------------------------------------- header")]
        # Inside the window at any size; the theme's own surface, line and shadow.
        self.assertIn("width: 'min(440px, calc(100% - 32px))', height: 'min(600px, calc(100% - 72px))'", chat)
        self.assertIn("background: C.bg, boxShadow: C.shadowModal", chat)
        self.assertIn("e.key !== 'Escape'", chat)
        switch = src[src.index("function ChatSwitch("):src.index("function Header(")]
        self.assertNotRegex(switch, r"#[0-9a-fA-F]{3,8}\b|rgba?\(")


if __name__ == "__main__":
    unittest.main()
