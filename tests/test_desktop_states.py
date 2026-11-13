"""The artifact beside its chat: the titlebar button, the dock, expand / Show chat, close (plugin.js).

Node drives desktop/plugin.js against a fake Hermes Desktop modelled on the v0.23.1 SDK
(apps/desktop/src/sdk/index.ts): nanostores atoms (listeners only on a change); host.navigate assigns
location.hash (hashchange); the app's HashRouter moves with history.pushState (no hashchange, only the
Navigation API's currententrychange) and the selected chat follows the route after the URL; the focused
stored session stays the chat's while a page shows; openWorkspace tiles; ctx.register disposers remove
by id. It plays the reported sequences (Artifacts page and back by the sidebar, another chat and back,
expand then Show chat, closes by the titlebar / pane / tab strip, a second artifact, a late list, a page
opened from the gallery) and checks after every step: the titlebar button is registered exactly when the
chat in front has an artifact and its route shows, at most one tile, $chat agrees with the tile, no tile
beside the Artifacts page, the dock belongs to the chat in front. Then the early pane: a `making` event
opens a being-made placeholder beside the chat in front (one tile), its step line follows the chat's tool
events, the publish's `open` swaps the same tile to the artifact, `ended` closes a placeholder without
remembering a close, a new making reopens a chat closed before, other chats stay quiet until they come in
front while busy, and a doc gets no placeholder. Then the reported faults: the sidebar's Artifacts row
always shows the gallery (an artifact only when the route names it), expand keeps the chat's sidebar row
lit (the tile goes over the chat on the chat's own route: no Artifacts row lit), the x on the expanded
tile is the chat alone and the person's close, and the neighbouring paths (a gallery card then Chat, the
chat card and the sidebar mark while expanded, a pinned route, another chat, a publish while expanded, a
reload while expanded or on an artifact). The sidebar highlight follows the host's rule
(app/chat/sidebar/index.tsx): a contributed nav row is lit only at its own pathname, a chat row only
while the route is a chat's. Skipped without node.
"""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin" / "desktop" / "plugin.js"
NODE = shutil.which("node")

SDK = r"""
// A stub of @hermes/plugin-sdk modelled on apps/desktop/src/sdk/index.ts (v0.23.1): nanostores atoms
// (listeners only on a change), host.navigate sets location.hash (hashchange), the app router moves with
// history.pushState (no hashchange; the Navigation API's currententrychange only), openWorkspace tiles.
export const atom = v => {
  let x = v
  const ls = new Set()
  return { get: () => x, set: n => { if (n === x) return; x = n; [...ls].forEach(f => f(n)) }, listen: f => (ls.add(f), () => ls.delete(f)), subscribe: f => (f(x), ls.add(f), () => ls.delete(f)) }
}
const W = globalThis.__W
export const host = W.host
export const ROUTES_AREA = 'routes', SIDEBAR_NAV_AREA = 'sidebar.nav', SIDEBAR_NAV_PREFS_AREA = 'sidebar.nav.prefs'
export const STATUSBAR_AREAS = { left: 'statusBar.left', right: 'statusBar.right' }
export const SESSION_ROW_AREAS = { leading: 'sessionRow.leading' }
export const SandboxedFrame = () => null
export const usePluginI18n = () => (k, ...a) => (a.length ? `${k}:${a.join(',')}` : k)
export const useValue = a => a.get()
export default {}
"""

REACT = r"""
const W = () => globalThis.__W
export const useEffect = f => { W().collect && W().collect.push(f) }
export const useLayoutEffect = () => {}
export const useRef = v => ({ current: v === undefined ? null : v })
export const useState = v => [typeof v === 'function' ? v() : v, () => {}]
export const useMemo = f => f()
export const useCallback = f => f
export default {}
"""

JSX = "export const jsx = (type, props) => ({ type, props }), jsxs = jsx, Fragment = Symbol('Fragment')\n"

RUN = r"""
// Drives plugin.js (copied to ./plugin.mjs with its imports pointed at the stubs) through the user's
// sequences against a fake Hermes Desktop and checks the invariants after every step.

const PAGE = '/hermes-artifacts'
const enc = encodeURIComponent
const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async () => { for (let i = 0; i < 20; i++) await tick() }

// ---------------------------------------------------------------- fake window
const window = new EventTarget()
window.navigation = new EventTarget()
let entryKey = 0
window.history = { state: { key: 'k0' } }
let hash = '#/'
window.location = {
  get hash() { return hash },
  set hash(v) { setRoute(v, true) }, // host.navigate: a hash assignment fires hashchange
  replace(v) { setRoute(v, true) }
}
globalThis.window = window
globalThis.document = Object.assign(new EventTarget(), { fullscreenElement: null, getElementById: () => null, documentElement: {}, head: {} })

// ---------------------------------------------------------------- fake host
const mk = v => { let x = v; const ls = new Set(); return { get: () => x, set: n => { if (n === x) return; x = n; [...ls].forEach(f => f(n)) }, listen: f => (ls.add(f), () => ls.delete(f)) } }
const selected = mk(null) // $selectedStoredSessionId; no session tiles here, so focused = selected
const tiles = new Map() // workspace tiles: id -> {opts, close}
const log = []
const host = {
  state: { focusedStoredSessionId: selected, busyBySession: mk({}), busy: mk(false), focusedSessionId: mk(null) },
  request: async (m, p) => (m === 'session.resume' ? { session_id: `rt-${p.session_id}` } : {}),
  composer: {},
  navigate(path) { window.location.hash = `#${path}` },
  async openSession(sid) { await tick(); routerNav(`/${enc(sid)}`) },
  openWorkspace(id, opts) {
    const prev = tiles.get(id)
    if (prev) log.push(`re-open ${id}`)
    const close = () => { if (tiles.get(id)?.close === close) tiles.delete(id); opts.onClose?.() }
    // The dock hint places a tile not yet in the layout; a re-open refreshes it where it is (revealTreePane).
    tiles.set(id, { opts, close, pos: prev ? prev.pos : (opts.dock?.pos || 'center') })
    return close
  }
}
globalThis.__W = { host, collect: null }

// The app's route effects: the selection follows a chat route (after the URL, as use-route-resume does);
// our page mounts on its route and unmounts off it.
let pageMounted = null, mountedKey = null
function setRoute(v, fireHash) {
  hash = v.startsWith('#') ? v : `#${v}`
  window.history.state = { key: `k${++entryKey}` }
  if (fireHash) window.dispatchEvent(new Event('hashchange'))
  window.navigation.dispatchEvent(new Event('currententrychange'))
  const path = hash.slice(1).split('?')[0]
  if (path === '/') selected.set(null)
  else if (!path.slice(1).includes('/') && !path.startsWith(PAGE) && !['/artifacts', '/capabilities'].includes(path)) selected.set(decodeURIComponent(path.slice(1)))
  const onPage = path === PAGE || path.startsWith(`${PAGE}/`)
  const key = onPage ? routeKey(path) : null
  if (pageMounted && key !== mountedKey) unmountPage()
  if (onPage && !pageMounted) { mountedKey = key; pageMounted = mount(routeElFor(path)) }
}
function unmountPage() { pageMounted.forEach(f => typeof f === 'function' && f()); pageMounted = null; mountedKey = null }
// Each route its own element: the page, or a pinned artifact's route.
const routeKey = path => (path.startsWith(`${PAGE}/pinned/`) ? `pinned-page:${decodeURIComponent(path.slice(PAGE.length + 8))}` : 'page')
const routeElFor = path => contribs.get(routeKey(path)).render()
// The HashRouter: history.pushState, so no hashchange.
function routerNav(path) { setRoute(`#${path}`, false) }

// ---------------------------------------------------------------- plugin
const contribs = new Map()
const storage = new Map()
let list = []
let openGate, listGate = new Promise(r => { openGate = r })
const evs = new Map() // gateway / plugin events the plugin listens to
const emit = (type, ev) => [...(evs.get(type) || [])].forEach(f => f(ev))
const makingSrv = {} // GET /making: what the backend says a chat is making
const ctx = {
  i18n: { register() {}, t: (k, ...a) => (a.length ? `${k}:${a.join(',')}` : k) },
  register(c) {
    contribs.set(c.id, c)
    return () => contribs.delete(c.id) // the real registry removes by id, whoever registered it
  },
  storage: { get: k => storage.get(k), set: (k, v) => storage.set(k, v) },
  async rest(path, o) {
    if (path === '/artifacts') await listGate
    if (path === '/artifacts') return { artifacts: JSON.parse(JSON.stringify(list)), folders: [] }
    if (path.endsWith('/chat')) return { known: true, exists: true, archived: false }
    if (path.startsWith('/making?session=')) { const sid = decodeURIComponent(path.split('=')[1]); return { making: makingSrv[sid] ? { session: sid, ...makingSrv[sid] } : null } }
    return {}
  },
  onEvent(type, fn) { if (!evs.has(type)) evs.set(type, new Set()); evs.get(type).add(fn); return () => evs.get(type).delete(fn) },
  setInterval(fn, ms) { const id = setInterval(fn, ms); id.unref?.(); return () => clearInterval(id) },
  setTimeout(fn, ms) { const id = setTimeout(fn, ms); return () => clearTimeout(id) },
  addEventListener(t, type, fn, o) { t.addEventListener(type, fn, o); return () => t.removeEventListener(type, fn, o) }
}

let mod = await import('./plugin.mjs')
let I = mod.__test
const routeEl = () => routeElFor(hash.slice(1).split('?')[0])

// A shallow renderer: function components are called (hooks are stubs), host elements collected.
const SKIP = new Set(['Gallery', 'CommentsPanel', 'FloatingChat', 'CommentPopover', 'ConfirmSend', 'Toast', 'PopMenu', 'TitleMenu'])
function expand(el, out = []) {
  if (el == null || typeof el !== 'object') return out
  if (Array.isArray(el)) { el.forEach(e => expand(e, out)); return out }
  if (typeof el.type === 'function') return SKIP.has(el.type.name) ? out : expand(el.type(el.props || {}), out)
  out.push(el)
  expand(el.props?.children, out)
  return out
}
// The top component's own effects run once (its [] effects: Page's mount), children's never.
function mount(el) {
  const fx = []
  globalThis.__W.collect = fx
  el.type(el.props)
  globalThis.__W.collect = null
  return fx.map(f => f())
}
const buttons = el => expand(el).filter(e => e.type === 'button')
const click = (el, pred, what) => {
  const b = buttons(el).find(pred)
  if (!b) throw new Error(`no ${what} button`)
  return b.props.onClick({ preventDefault() {}, stopPropagation() {} })
}
const titlebar = () => contribs.get('chat-artifact-slot')
const tileEl = () => [...tiles.values()][0]?.opts.render()
const tilePos = () => [...tiles.values()][0]?.pos || null
// Which sidebar row Hermes lights (app/chat/sidebar/index.tsx): our nav row at pathname === its path only;
// a chat row while the view is a chat (a chat route; no session tiles here).
function lit() {
  const path = hash.slice(1).split('?')[0]
  if (path === PAGE) return 'artifacts'
  if (path === '/' || (!path.slice(1).includes('/') && !path.startsWith(PAGE) && !['/artifacts', '/capabilities'].includes(path))) return `chat:${selected.get()}`
  return 'none'
}
const hasEl = (el, name) => {
  if (el == null || typeof el !== 'object') return false
  if (Array.isArray(el)) return el.some(e => hasEl(e, name))
  if (typeof el.type === 'function' && el.type.name === name) return true
  if (typeof el.type === 'function') return SKIP.has(el.type.name) ? false : hasEl(el.type(el.props || {}), name)
  return hasEl(el.props?.children, name)
}

// ---------------------------------------------------------------- invariants
const fails = []
let step = ''
function check(expect = {}) {
  const sid = selected.get()
  const path = hash.slice(1).split('?')[0]
  const onChat = path === '/' || path === `/${enc(sid || '')}`
  const has = Boolean(sid && (list.some(a => a.session === sid) || I.$makings.get()[sid]))
  const want = onChat && has
  const bad = m => fails.push(`[${step}] ${m}`)
  if (Boolean(titlebar()) !== want) bad(`titlebar button ${titlebar() ? 'shown' : 'missing'} (route ${path}, chat ${sid})`)
  if (tiles.size > 1) bad(`${tiles.size} tiles`)
  const chat = I.$chat.get()
  if ((chat === 'split') !== (tiles.size === 1)) bad(`$chat=${chat} with ${tiles.size} tile(s)`)
  if (tiles.size && pageMounted) bad('a tile beside the Artifacts page')
  if (chat === 'split' && (I.$dockMaking.get() || I.current()?.session) !== sid) bad(`docked ${I.$dockMaking.get() || I.$selected.get()} beside chat ${sid}`)
  if (I.$dockMaking.get() && chat !== 'split') bad('a placeholder with no tile')
  if ('making' in expect && I.$dockMaking.get() !== expect.making) bad(`expected placeholder for ${expect.making}, got ${I.$dockMaking.get()}`)
  if ('reopens' in expect) { const n = log.filter(x => x.startsWith('re-open')).length; if (n !== expect.reopens) bad(`expected ${expect.reopens} in-place re-open(s), got ${n}`); log.length = 0 }
  if ('closed' in expect) { const c = (storage.get('closedIn') || []).includes(sid); if (c !== expect.closed) bad(`expected closedIn ${expect.closed} for ${sid}`) }
  if ('split' in expect && (chat === 'split') !== expect.split) bad(`expected split=${expect.split}, $chat=${chat}`)
  if ('page' in expect && Boolean(pageMounted) !== expect.page) bad(`expected page=${expect.page}`)
  if ('titlebarOpen' in expect) { const b = titlebar() && buttons(titlebar().render())[0]; if (!b || b.props['aria-pressed'] !== expect.titlebarOpen) bad('titlebar button not in the open state') }
  if ('selected' in expect && I.$selected.get() !== expect.selected) bad(`expected selected=${expect.selected}, got ${I.$selected.get()}`)
  // The plugin's idea of where the tile is matches the host's; a tile over the chat only on its chat route.
  if (tiles.size && I.$dockPos.get() !== tilePos()) bad(`$dockPos=${I.$dockPos.get()} with the tile at ${tilePos()}`)
  if (tilePos() === 'center' && !onChat) bad('an expanded tile off its chat route')
  // Plain #/hermes-artifacts is the gallery, whatever was selected before (fault 1).
  if (pageMounted && hash === `#${PAGE}` && I.$selected.get()) bad(`the plain Artifacts route shows ${I.$selected.get()}, not the gallery`)
  if ('gallery' in expect && (Boolean(pageMounted) && hasEl(routeEl(), 'Gallery')) !== expect.gallery) bad(`expected gallery=${expect.gallery}`)
  if ('expanded' in expect && (tilePos() === 'center') !== expect.expanded) bad(`expected expanded=${expect.expanded}, tile at ${tilePos()}`)
  if ('lit' in expect && lit() !== expect.lit) bad(`expected the ${expect.lit} sidebar row lit, got ${lit()}`)
  if ('route' in expect && hash !== expect.route) bad(`expected route ${expect.route}, got ${hash}`)
}
async function S(name, fn, expect) {
  step = name
  try { await fn() } catch (e) { fails.push(`[${step}] threw: ${e.message}`) }
  await settle()
  check(expect)
}

// ---------------------------------------------------------------- scenarios
const A = { id: 'a1', title: 'Alpha', type: 'page', session: 'chatA', updated: 1, version: 1 }
const A2 = { id: 'a2', title: 'Alpha two', type: 'doc', session: 'chatA', updated: 3, version: 1 }
const B = { id: 'b1', title: 'Beta', type: 'page', session: 'chatB', updated: 2, version: 1 }
list = [A, B]

routerNav('/chatA') // the app starts on chat A; the list arrives later
let stop = mod.default.register(ctx)
await settle()
await S('start on chat A, list late', () => openGate(), { split: true, selected: 'a1', titlebarOpen: true })
await S('to Artifacts page by the sidebar: the gallery, not the docked artifact', () => routerNav(PAGE), { split: false, page: true, gallery: true, selected: null, lit: 'artifacts' })
await S('back to chat A by the sidebar', () => routerNav('/chatA'), { split: true })
await S('to chat B', () => routerNav('/chatB'), { split: true, selected: 'b1' })
await S('back to chat A', () => routerNav('/chatA'), { split: true, selected: 'a1' })
const EXP = { split: true, expanded: true, page: false, lit: 'chat:chatA', route: '#/chatA', titlebarOpen: true }
await S('expand from the split: over the chat, the chat row stays lit', () => click(tileEl(), b => b.props.title === 'expand', 'expand'), { ...EXP, selected: 'a1', closed: false })
await S('the expanded tile offers one Show chat, its Pop out chat, and no expand', () => {
  const bs = buttons(tileEl()).map(b => b.props.title)
  if (bs.filter(x => x === 'showChat').length !== 1 || bs.filter(x => x === 'popOut').length !== 1 || bs.includes('expand') || bs.includes('chat')) throw new Error('header buttons ' + bs.join(' '))
  if (I.$dockFloat.get()) throw new Error('a plain expand opened the floating chat')
}, EXP)
await S('Show chat: beside the chat again', () => click(tileEl(), b => b.props.title === 'showChat', 'Show chat'), { split: true, expanded: false, page: false, selected: 'a1', titlebarOpen: true, lit: 'chat:chatA', closed: false })
await S('expand again', () => click(tileEl(), b => b.props.title === 'expand', 'expand'), EXP)
await S('the Artifacts row while expanded: the gallery', () => routerNav(PAGE), { split: false, page: true, gallery: true, lit: 'artifacts' })
await S('back to chat A by the sidebar after expand: beside', () => routerNav('/chatA'), { split: true, expanded: false, page: false, titlebarOpen: true })
await S('expand is not a close (persisted state)', () => { if ((storage.get('closedIn') || []).includes('chatA')) throw new Error('chatA marked closed') }, { split: true })
await S('expand, then its x: the chat alone, the person\'s close', async () => {
  click(tileEl(), b => b.props.title === 'expand', 'expand'); await settle()
  click(tileEl(), b => b.props.title === 'close', 'close')
}, { split: false, page: false, lit: 'chat:chatA', route: '#/chatA', closed: true })
await S('reopen with the titlebar button after that close', () => click(titlebar().render(), () => true, 'titlebar'), { split: true, expanded: false, selected: 'a1', closed: false })
await S('close with the titlebar button', () => click(titlebar().render(), () => true, 'titlebar'), { split: false })
await S('the close is persisted (a reload keeps it closed)', () => { if (!(storage.get('closedIn') || []).includes('chatA')) throw new Error('not persisted') }, { split: false })
await S('to chat B and back: stays closed', async () => { routerNav('/chatB'); await settle(); routerNav('/chatA') }, { split: false })
await S('reopen with the titlebar button', () => click(titlebar().render(), () => true, 'titlebar'), { split: true, selected: 'a1' })
await S('close with the tab strip', () => [...tiles.values()][0].close(), { split: false })
await S('to chat B and back after the strip close: stays closed', async () => { routerNav('/chatB'); await settle(); routerNav('/chatA') }, { split: false })
await S('reopen from the titlebar', () => click(titlebar().render(), () => true, 'titlebar'), { split: true })
await S('a second artifact in chat A, late list refresh', async () => { list = [A, A2, B]; routerNav(PAGE); await settle(); routerNav('/chatA') }, { split: true })
await S('gallery: open B full page, then Chat', async () => {
  routerNav(PAGE); await settle(); I.openArtifact(ctx, 'b1'); await settle(); if (buttons(routeEl()).some(b => b.props.title === 'showChat')) throw new Error('Show chat on a gallery-opened page')
  click(routeEl(), b => b.props.title === 'chat', 'Chat')
}, { split: true, page: false, selected: 'b1', titlebarOpen: true })
await S('the dock close (header x) in chat B', () => click(tileEl(), b => b.props.title === 'close', 'close'), { split: false })
await S('Settings-like page and back', async () => { routerNav('/capabilities'); await settle(); routerNav('/chatB') }, { split: false })

// ---------------------------------------------------------------- the page's route and the neighbours of expand
const card = id => ({ type: I.ChatArtifactCard, props: { ctx, attrs: { id } } })
await S('a gallery card names its artifact in the route', async () => { routerNav(PAGE); await settle(); I.openOnPage(ctx, 'a1') }, { page: true, gallery: false, selected: 'a1', route: `#${PAGE}?artifact=a1`, lit: 'artifacts' })
await S('remounted on that artifact: the same artifact', async () => { unmountPage(); I.closeArtifact(); setRoute(hash, false) }, { page: true, selected: 'a1', gallery: false })
await S('back to the gallery (its history entry)', () => routerNav(PAGE), { page: true, gallery: true, selected: null })
await S('the x on a page artifact: the gallery', async () => { I.openOnPage(ctx, 'b1'); await settle(); click(routeEl(), b => b.props.title === 'close', 'close') }, { page: true, gallery: true, route: `#${PAGE}` })
await S('an older artifact of chat A from the gallery, then Chat: that one beside its chat', async () => {
  I.openOnPage(ctx, 'a1'); await settle()
  click(routeEl(), b => b.props.title === 'chat', 'Chat')
}, { split: true, page: false, selected: 'a1', lit: 'chat:chatA', titlebarOpen: true })
await S('expand, then the chat card in the transcript: beside again', async () => {
  click(tileEl(), b => b.props.title === 'expand', 'expand'); await settle()
  click(card('a1'), () => true, 'card')
}, { split: true, expanded: false, selected: 'a1', lit: 'chat:chatA', closed: false })
await S('the card again beside: nothing changes', () => { log.length = 0; click(card('a1'), () => true, 'card') }, { split: true, expanded: false, selected: 'a1', reopens: 0 })
await S('expand, then the sidebar mark on the chat row: beside again', async () => {
  click(tileEl(), b => b.props.title === 'expand', 'expand'); await settle()
  click(contribs.get('pin-mark').data.render({ sessionId: 'chatA' }), () => true, 'mark')
}, { split: true, expanded: false, lit: 'chat:chatA', closed: false })
await S('expanded, a pinned artifact\'s route: that artifact, no tile', async () => {
  list = list.map(a => (a.id === 'b1' ? { ...a, pinned: true } : a)); await I.refresh(ctx)
  click(tileEl(), b => b.props.title === 'expand', 'expand'); await settle()
  routerNav(`${PAGE}/pinned/b1`)
}, { split: false, page: true, selected: 'b1', gallery: false, lit: 'none', closed: false })
await S('from the pinned route to the Artifacts row: the gallery', () => routerNav(PAGE), { page: true, gallery: true, lit: 'artifacts' })
await S('back to chat A: beside, not expanded', () => routerNav('/chatA'), { split: true, expanded: false, lit: 'chat:chatA' })
await S('expanded, then another chat (closed there before): that chat alone', async () => {
  click(tileEl(), b => b.props.title === 'expand', 'expand'); await settle()
  routerNav('/chatB')
}, { split: false, lit: 'chat:chatB', closed: true })
await S('back to chat A after that: beside, and not closed', () => routerNav('/chatA'), { split: true, expanded: false, lit: 'chat:chatA', closed: false })
await S('expanded, Hermes publishes another artifact in this chat: the same tile, still over the chat', async () => {
  click(tileEl(), b => b.props.title === 'expand', 'expand'); await settle()
  log.length = 0
  list = [...list, { id: 'a3', title: 'Alpha three', type: 'page', session: 'chatA', updated: 20, version: 1 }]
  emit('plugin.hermes-artifacts.open', { payload: { id: 'a3', session: 'chatA' } })
}, { ...EXP, selected: 'a3', reopens: 1 })
await S('expanded, the titlebar button closes it: the chat alone', () => click(titlebar().render(), () => true, 'titlebar'), { split: false, lit: 'chat:chatA', route: '#/chatA', closed: true })
await S('the titlebar button opens it beside again', () => click(titlebar().render(), () => true, 'titlebar'), { split: true, expanded: false, closed: false })

// ---------------------------------------------------------------- the early pane (an artifact being made)
const texts = el => expand(el).map(e => e.props?.children).filter(c => typeof c === 'string')
const making = (session, phase, extra = {}) => emit('plugin.hermes-artifacts.making', { payload: { session, phase, started: 1, ...extra } })
const opened = (art, extra = {}) => emit('plugin.hermes-artifacts.open', { payload: { id: art.id, title: art.title, type: art.type, version: 1, session: art.session, ...extra } })
const tool = (type, name, args) => emit(type, { type, payload: args ? { name, args } : { name } })
const C1 = { id: 'c1', title: 'Deck', type: 'slides', session: 'chatC', updated: 5, version: 1 }

await S('a new chat with nothing made', () => routerNav('/chatC'), { split: false })
await S('Hermes reads the slides guide: the placeholder beside the chat', () => making('chatC', 'guide', { type: 'slides' }), { split: true, making: 'chatC', titlebarOpen: true })
await S('the placeholder says the type and the step', () => {
  const ts = texts(tileEl())
  if (!ts.includes('type_slides') || !ts.some(x => x.startsWith('stepGuide:'))) throw new Error('placeholder text ' + ts.join(' | '))
}, { split: true, making: 'chatC' })
await S('writing, then publishing with its title', async () => {
  tool('tool.generating', 'ha_publish')
  await settle()
  if (!texts(tileEl()).some(x => x.startsWith('stepWrite:'))) throw new Error('no writing step')
  tool('tool.start', 'tool_call', { calls: [{ name: 'ha_publish', arguments: { type: 'slides', title: 'Deck' } }] })
  await settle()
  const ts = texts(tileEl())
  if (!ts.includes('Deck') || !ts.includes('stepPublish')) throw new Error('no title or publishing step ' + ts.join(' | '))
}, { split: true, making: 'chatC' })
await S('a making in another chat shows nothing here', () => making('chatD', 'guide', { type: 'page' }), { split: true, making: 'chatC' })
await S('published: the same tile becomes the artifact', async () => {
  list = [A, A2, B, C1]
  making('chatC', 'done', { id: 'c1', title: 'Deck', type: 'slides' })
  opened(C1)
}, { split: true, making: null, selected: 'c1', titlebarOpen: true, reopens: 1 })
await S('the other chat ends quietly', () => making('chatD', 'ended', { type: 'page' }), { split: true, selected: 'c1' })
await S('close the artifact in chat C', () => click(titlebar().render(), () => true, 'titlebar'), { split: false, closed: true })
await S('a new making in a closed chat shows again', () => making('chatC', 'guide', { type: 'page' }), { split: true, making: 'chatC', closed: false })
await S('the turn ends without a publish: the placeholder goes, not as a close', () => making('chatC', 'ended'), { split: false, making: null, closed: false })

await S('chat E: a placeholder', async () => { routerNav('/chatE'); await settle(); making('chatE', 'guide', { type: 'dashboard' }) }, { split: true, making: 'chatE' })
await S('the person closes the placeholder (its x)', () => click(tileEl(), b => b.props.title === 'close', 'close'), { split: false, closed: true })
await S('the titlebar shows it again', () => click(titlebar().render(), () => true, 'titlebar'), { split: true, making: 'chatE', closed: false, titlebarOpen: true })
await S('closed by the tab strip', () => [...tiles.values()][0].close(), { split: false, closed: true })
await S('its publish opens it anyway (new artifact)', async () => {
  list = [...list, { id: 'e1', title: 'Board', type: 'dashboard', session: 'chatE', updated: 6, version: 1 }]
  opened(list[list.length - 1])
}, { split: true, selected: 'e1', closed: false, reopens: 0 })

await S('chat F: a placeholder, Hermes still working', async () => { host.state.busy.set(true); routerNav('/chatF'); await settle(); making('chatF', 'guide', { type: 'design' }) }, { split: true, making: 'chatF' })
await S('to chat B: the placeholder goes with its chat', () => routerNav('/chatB'), { split: false })
await S('back to chat F, still making: it is back', () => routerNav('/chatF'), { split: true, making: 'chatF', closed: false })
await S('chat F ends', () => making('chatF', 'ended'), { split: false })

await S('after a reload: a busy chat the backend says is making', async () => { makingSrv.chatG = { type: 'sheet', phase: 'guide' }; routerNav('/chatG') }, { split: true, making: 'chatG' })
await S('chat G ends', async () => { making('chatG', 'ended'); delete makingSrv.chatG }, { split: false })
await S('a chat not busy shows nothing from the backend', async () => { host.state.busy.set(false); makingSrv.chatH = { type: 'page' }; routerNav('/chatH') }, { split: false })
await S('a doc gets no placeholder', async () => { routerNav('/chatI'); await settle(); making('chatI', 'guide', { type: 'doc' }) }, { split: false })
await S('a publish with no guide this turn: a placeholder from the tool event', async () => {
  routerNav('/chatJ'); await settle(); host.state.busy.set(true); await settle(); tool('tool.generating', 'ha_publish')
}, { split: true, making: 'chatJ' })
await S('that turn ends: it goes', () => host.state.busy.set(false), { split: false, closed: false })

// ---------------------------------------------------------------- reloads (the plugin's state is in memory only)
// A reload: a fresh copy of the module; Hermes drops the tile it has no registration for while hydrating
// the layout (store.ts hydrateContributedPanes), then the plugin registers again.
async function reload() {
  if (pageMounted) unmountPage()
  stop?.()
  for (const t of tiles.values()) t.opts.onClose = null
  tiles.clear(); contribs.clear(); evs.clear()
  mod = await import(`./plugin.mjs?r=${Math.random()}`)
  I = mod.__test
  stop = mod.default.register(ctx)
  const path = hash.slice(1).split('?')[0]
  if (path === PAGE || path.startsWith(`${PAGE}/`)) { await settle(); mountedKey = routeKey(path); pageMounted = mount(routeElFor(path)) }
}
await S('reload while expanded: the chat with its artifact beside it', async () => {
  routerNav('/chatA'); await settle()
  if (I.$chat.get() !== 'split') click(titlebar().render(), () => true, 'titlebar')
  await settle()
  click(tileEl(), b => b.props.title === 'expand', 'expand'); await settle()
  await reload()
}, { split: true, expanded: false, lit: 'chat:chatA', closed: false, titlebarOpen: true })
await S('reload on the gallery: the gallery', async () => { routerNav(PAGE); await settle(); await reload() }, { page: true, gallery: true, split: false })
await S('reload on an artifact page: that artifact', async () => { I.openOnPage(ctx, 'b1'); await settle(); await reload() }, { page: true, selected: 'b1', gallery: false })

// ---------------------------------------------------------------- feedback: the tab title, toasts, exports, the step line, Hermes' runs
const tabTitle = () => [...tiles.values()][0]?.opts.title ?? null
await S('chat A with its artifact beside it', async () => {
  routerNav('/chatA'); await settle()
  if (I.$chat.get() !== 'split') click(titlebar().render(), () => true, 'titlebar')
  log.length = 0
}, { split: true, closed: false })
await S('another artifact of the chat by its card: the tab says that one, not the one before', async () => {
  const other = I.$selected.get() === 'a1' ? 'a3' : 'a1'
  click(card(other), () => true, 'card'); await settle()
  const want = list.find(a => a.id === other).title
  if (I.$selected.get() !== other || tabTitle() !== want) throw new Error(`tab "${tabTitle()}" over ${I.$selected.get()}`)
}, { split: true, reopens: 1 })
await S('renamed: the tab follows', async () => {
  list = list.map(a => (a.id === I.$selected.get() ? { ...a, title: 'Renamed' } : a)); await I.refresh(ctx)
  if (tabTitle() !== 'Renamed') throw new Error(`tab "${tabTitle()}"`)
}, { split: true, reopens: 1 })
await S('a placeholder retitles its tab once the type is known', async () => {
  routerNav('/chatK'); await settle(); host.state.busy.set(true); await settle()
  tool('tool.generating', 'ha_publish'); await settle()
  if (tabTitle() !== 'makingTab:makingArtifact') throw new Error(`tab "${tabTitle()}"`)
  tool('tool.start', 'ha_publish', { type: 'sheet', title: 'Budget' }); await settle()
  if (tabTitle() !== 'makingTab:type_sheet') throw new Error(`tab "${tabTitle()}"`)
  host.state.busy.set(false)
}, { split: false, reopens: 1 })

await S('a toast in the pane beside the chat (a Desktop without host.notify): drawn in the pane', async () => {
  routerNav('/chatA'); await settle()
  I.toast('hello')
  if (I.$toast.get() !== 'hello' || !hasEl(tileEl(), 'Toast')) throw new Error('no toast in the pane')
  const st = I.Toast().props.style
  if (!String(st.background).includes('--ui-bg-elevated') || String(st.background).includes('foreground') || !String(st.border).includes('--ui-stroke')) throw new Error('toast look ' + JSON.stringify(st))
  log.length = 0
}, { split: true })
const notes = []
await S('with Hermes\' own notifications: every toast goes there (the docked Copy too), errors as errors', async () => {
  host.notify = n => notes.push([n.kind, n.message])
  I.$toast.set(null)
  I.toast('plain')
  I.toast('broke', 'error')
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })
  const copied = await I.copyCommand("hermes config set plugins.entries.hermes-artifacts.mcp_allowlist '[srv]'", k => k)
  if (!copied) throw new Error('copy failed')
  if (JSON.stringify(notes) !== JSON.stringify([['info', 'plain'], ['error', 'broke'], ['info', 'allowCopied']])) throw new Error(JSON.stringify(notes))
  if (I.$toast.get() !== null) throw new Error('the plugin drew its own toast too')
}, { split: true })
await S('an export handed to the browser says "Saved <name>"; one that fails says why', async () => {
  notes.length = 0
  const doc = globalThis.document, U = globalThis.URL, made = []
  const keep = { ce: doc.createElement, body: doc.body, co: U.createObjectURL, rv: U.revokeObjectURL }
  doc.createElement = () => ({ click() { made.push(this.download) }, remove() {} })
  doc.body = { appendChild() {} }
  U.createObjectURL = () => 'blob:x'
  U.revokeObjectURL = () => {}
  const ok = I.saveFile('Budget.xlsx', new Blob(['x'], { type: 'application/zip' }))
  doc.createElement = () => { throw new Error('blocked') }
  const bad = I.saveFile('Budget.pdf', 'x', 'application/pdf')
  Object.assign(doc, { createElement: keep.ce, body: keep.body })
  Object.assign(U, { createObjectURL: keep.co, revokeObjectURL: keep.rv })
  if (ok !== true || bad !== false || made.join() !== 'Budget.xlsx') throw new Error(`ok=${ok} bad=${bad} made=${made}`)
  if (JSON.stringify(notes) !== JSON.stringify([['success', 'saved:Budget.xlsx'], ['error', 'saveFailed:Budget.pdf,blocked']])) throw new Error(JSON.stringify(notes))
}, { split: true })

await S('Hermes makes another artifact in a chat whose artifact is open: the pane keeps it and says the step', async () => {
  making('chatA', 'guide', { type: 'board' }); await settle()
  const ts = texts(tileEl())
  if (!ts.some(x => x === 'makingBand:type_board · stepGuide:type_board')) throw new Error('step line ' + ts.join(' | '))
}, { split: true, making: null, reopens: 0 })
await S('the ha_* tool events move the step line (the deferred bridge, MCP-style names)', async () => {
  const line = () => texts(tileEl()).find(x => x.startsWith('makingBand:')) || ''
  const seen = []
  tool('tool.complete', 'ha_guide'); await settle(); seen.push(line())
  tool('tool.generating', 'mcp__tool_call'); await settle(); seen.push(line())
  tool('tool.start', 'ha_check'); await settle(); seen.push(line())
  tool('tool.generating', 'mcp__web_search'); await settle(); seen.push(line())
  tool('tool.start', 'ha_publish', { type: 'board', title: 'Flow' }); await settle(); seen.push(line())
  const want = ['stepThink', 'stepWrite:type_board', 'stepTool:check', 'stepTool:web search', 'stepPublish'].map(s => `makingBand:type_board · ${s}`)
  if (JSON.stringify(seen) !== JSON.stringify(want)) throw new Error(JSON.stringify(seen))
  making('chatA', 'ended'); await settle()
  if (texts(tileEl()).some(x => x.startsWith('makingBand:'))) throw new Error('the line stayed after the turn')
}, { split: true, making: null, reopens: 0 })
await S('a doc made in that chat says its step there too', async () => {
  making('chatA', 'guide', { type: 'doc' }); await settle()
  if (!texts(tileEl()).includes('makingBand:type_doc · stepGuide:type_doc')) throw new Error(texts(tileEl()).join(' | '))
  making('chatA', 'ended')
}, { split: true, making: null, reopens: 0 })

await S('Hermes\' runs reach the open pages: on with its age, off when the last one ends', async () => {
  const seen = [], ref = { current: { postMessage: m => seen.push(m) } }
  I.themePorts.add(ref)
  host.state.busy.set(true); await settle()
  host.state.busyBySession.set({ rt1: true }); host.state.busy.set(false); await settle() // another chat still runs
  host.state.busyBySession.set({ rt1: false }); await settle()
  I.themePorts.delete(ref)
  const runs = seen.filter(m => m.event === 'run').map(m => m.detail)
  if (JSON.stringify(runs.map(d => d.on)) !== '[true,false]' || typeof runs[0].age !== 'number' || runs[1].age !== null) throw new Error(JSON.stringify(runs))
}, { split: true })
await S('the full page draws the toast too', async () => { routerNav(PAGE); await settle(); if (!hasEl(routeEl(), 'Toast')) throw new Error('no Toast on the page') }, { page: true })
delete host.notify


console.log(JSON.stringify({ fails, log }, null, 1))
process.exit(0)
"""


@unittest.skipIf(NODE is None, "node not installed")
class DesktopStateTests(unittest.TestCase):
    def test_beside_expand_close_sequences(self):
        d = Path(tempfile.mkdtemp(prefix="ha-states-"))
        src = (PLUGIN.read_text("utf-8").replace("from '@hermes/plugin-sdk'", "from './sdk.mjs'")
               .replace("from 'react/jsx-runtime'", "from './jsx.mjs'").replace("from 'react'", "from './react.mjs'"))
        # The internals the invariants read, exported from the copy only.
        src += ("\nexport const __test = { $chat, $selected, current, openArtifact, openOnPage, closeArtifact, refresh, toast, $toast, Toast,"
                " saveFile, copyCommand, themePorts,"
                " $makings, $dockMaking, $dockPos, ChatArtifactCard, $chatMode, $dockFloat, FloatingChat, chatState }\n")
        (d / "plugin.mjs").write_text(src, "utf-8")
        (d / "sdk.mjs").write_text(SDK, "utf-8")
        (d / "react.mjs").write_text(REACT, "utf-8")
        (d / "jsx.mjs").write_text(JSX, "utf-8")
        (d / "run.mjs").write_text(RUN, "utf-8")
        r = subprocess.run([NODE, "run.mjs"], cwd=d, capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout[r.stdout.index("{"):])
        self.assertEqual(out["fails"], [], "\n".join(out["fails"]))
        self.assertEqual(out["log"], [])
        shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
