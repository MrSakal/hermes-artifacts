// Reads, over the staging Desktop's CDP port, the PLUGIN_VERSION of every hermes-artifacts Desktop half the
// renderer actually loaded (the loader imports plugin.js from a blob: URL), and whether the plugin's route
// replaced the built-in Artifacts page. Prints one JSON line. Usage: node verify-window.mjs <port>
const port = process.argv[2] || '9333'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find(t => t.type === 'page' && t.url.includes('index.html')) || list.find(t => t.type === 'page')
if (!page) { console.log(JSON.stringify({ error: 'no page target' })); process.exit(2) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let id = 0
const pending = new Map()
const scripts = []
ws.onmessage = ev => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Debugger.scriptParsed') scripts.push(m.params)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Debugger.enable') // replays scriptParsed for every script already loaded
await new Promise(r => setTimeout(r, 1500))
const versions = []
for (const s of scripts) {
  if (!s.url.startsWith('blob:') && !/hermes-artifacts/.test(s.url)) continue
  const src = (await send('Debugger.getScriptSource', { scriptId: s.scriptId })).result?.scriptSource || ''
  const m = /const PLUGIN_VERSION = '([^']+)'/.exec(src)
  if (m && /hermes-artifacts/.test(src)) versions.push(m[1])
}
await send('Debugger.disable')
const nav = await send('Runtime.evaluate', {
  awaitPromise: true, returnByValue: true,
  expression: `(async () => { location.hash = '#/hermes-artifacts'; await new Promise(r => setTimeout(r, 3000));
    return { hash: location.hash, builtIn: /\\bImages\\b/.test(document.querySelector('main')?.innerText || document.body.innerText) } })()`
})
console.log(JSON.stringify({ loadedVersions: [...new Set(versions)], route: nav.result?.result?.value ?? null }))
ws.close()
process.exit(0)
