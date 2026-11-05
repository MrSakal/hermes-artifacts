/**
 * hermes-artifacts — desktop half. Replaces the built-in Artifacts page:
 *
 *  - registers a full page at /hermes-artifacts (ROUTES_AREA): artifact list + viewer;
 *  - sends every navigation to the built-in /artifacts (sidebar row, keybind, palette) there with
 *    location.replace, without touching the sidebar, its markup or any core object;
 *  - fetches each artifact's HTML (bridge already injected) through its own plugin API, so it works
 *    against a remote Hermes server, and renders it as a data: URL in a SandboxedFrame (opaque origin);
 *  - is the bridge host (the role Claude Desktop's cowork-artifact://shell plays):
 *      artifact --hello--> page --MessagePort--> artifact; ops go to ctx.rest.
 *
 * send(): always lands in the inbox; with a user gesture it is submitted to the active chat, without one
 * it only fills the composer draft. User activation inside the frame propagates to this ancestor, so
 * navigator.userActivation is read here and never trusted from the page.
 *
 * Plain ESM, loaded uncompiled. Only @hermes/plugin-sdk, react and react/jsx-runtime resolve.
 */

import {
  atom,
  Codicon,
  host,
  ROUTES_AREA,
  SandboxedFrame,
  SIDEBAR_NAV_AREA,
  SIDEBAR_NAV_PREFS_AREA,
  usePluginI18n,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-artifacts'
const PAGE = '/hermes-artifacts'
const CORE = '/artifacts'
// The built-in view opened on purpose: the router ignores the query, the redirect does not.
const CORE_KEEP = `${CORE}?from=${'hermes-artifacts'}`
const SANDBOX = 'allow-forms allow-downloads'

const STRINGS = {
  en: {
    title: 'Artifacts',
    refresh: 'Refresh',
    reload: 'Reload',
    version: 'Version',
    empty: 'No artifacts yet. Ask Hermes to publish one.',
    pick: 'Pick an artifact.',
    loading: 'Loading…',
    loadFailed: err => `Could not load it: ${err}`,
    backendDown: err =>
      `The plugin backend is not reachable (${err}). Install and enable hermes-artifacts on the Hermes ` +
      'this app is connected to, then restart its gateway.',
    sessionFiles: 'Session files and images →',
    sessionFilesTip: 'The built-in view: images and files from your sessions',
    back: 'Back to Artifacts'
  },
  hu: {
    title: 'Artifacts',
    refresh: 'Frissítés',
    reload: 'Újratöltés',
    version: 'Verzió',
    empty: 'Még nincs artifact. Kérd meg a Hermest, hogy publikáljon egyet.',
    pick: 'Válassz egy artifactot.',
    loading: 'Betöltés…',
    loadFailed: err => `Nem sikerült betölteni: ${err}`,
    backendDown: err =>
      `A plugin backend nem érhető el (${err}). Telepítsd és engedélyezd a hermes-artifacts plugint azon a ` +
      'Hermesen, amihez az app kapcsolódik, majd indítsd újra a gatewayt.',
    sessionFiles: 'Session-fájlok és képek →',
    sessionFilesTip: 'A beépített nézet: képek és fájlok a sessionökből',
    back: 'Vissza az Artifactsra'
  }
}

const $list = atom([])
const $selected = atom(null) // artifact id
const $shown = atom(null) // pinned version, null = latest
const $nonce = atom(0)
const $error = atom(null)


const payloadOf = ev => (ev && (ev.payload ?? ev.data ?? ev.params)) || ev || {}
const current = () => $list.get().find(a => a.id === $selected.get()) || null

async function refresh(ctx) {
  try {
    const r = await ctx.rest('/artifacts')
    const list = r.artifacts || []
    const prev = current()
    // Only re-render when something changed (the poll runs every 5 s, possibly over a LAN round trip).
    if (JSON.stringify(list) !== JSON.stringify($list.get())) $list.set(list)
    $error.set(null)
    if (!$selected.get() && list.length) {
      const last = ctx.storage.get('last')
      $selected.set(list.some(a => a.id === last) ? last : list[0].id)
    }
    const now = current()
    if (prev && now && now.version !== prev.version && $shown.get() === null) $nonce.set($nonce.get() + 1)
  } catch (err) {
    $error.set(String(err?.message || err))
  }
}

function select(ctx, id) {
  $selected.set(id)
  $shown.set(null)
  ctx.storage.set('last', id)
  $nonce.set($nonce.get() + 1)
}

/** UTF-8 safe base64 for a data: URL (chunked, so large pages do not hit the argument limit). */
function toDataUrl(html) {
  const bytes = new TextEncoder().encode(html)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return `data:text/html;charset=utf-8;base64,${btoa(bin)}`
}

const muted = 'text-xs text-(--ui-text-tertiary)'
const ghostBtn =
  'h-6 rounded px-1.5 text-xs text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'

// ---------------------------------------------------------------- list column

function ListColumn({ ctx }) {
  const t = usePluginI18n(ID)
  const list = useValue($list)
  const sel = useValue($selected)
  const err = useValue($error)

  const body = err
    ? jsx('p', { className: `px-2 py-3 ${muted}`, children: t('backendDown', err) })
    : list.length === 0
      ? jsx('p', { className: `px-2 py-3 ${muted}`, children: t('empty') })
      : list.map(a =>
          jsxs(
            'button',
            {
              type: 'button',
              onClick: () => select(ctx, a.id),
              className:
                'flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ' +
                (a.id === sel
                  ? 'bg-(--chrome-action-hover) text-foreground'
                  : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'),
              children: [
                jsx('span', { className: 'w-full truncate text-[0.8125rem]', children: a.title }),
                jsx('span', {
                  className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
                  children: `v${a.version}` + (a.updated ? ' · ' + new Date(a.updated * 1000).toLocaleString() : '')
                })
              ]
            },
            a.id
          )
        )

  return jsxs('aside', {
    className: 'flex min-h-0 w-64 shrink-0 flex-col border-r border-(--ui-stroke-secondary)',
    children: [
      jsxs('div', {
        className: 'flex h-9 shrink-0 items-center justify-between px-3',
        children: [
          jsx('span', { className: 'text-sm font-medium text-foreground', children: t('title') }),
          jsx('button', { type: 'button', title: t('refresh'), className: ghostBtn, onClick: () => refresh(ctx), children: '↻' })
        ]
      }),
      jsx('div', { className: 'min-h-0 flex-1 overflow-y-auto px-1.5 pb-2', children: body }),
      jsx('button', {
        type: 'button',
        className:
          'shrink-0 border-t border-(--ui-stroke-secondary) px-3 py-2 text-left text-[0.6875rem] text-(--ui-text-quaternary) hover:text-foreground',
        title: t('sessionFilesTip'),
        onClick: () => host.navigate(CORE_KEEP),
        children: t('sessionFiles')
      })
    ]
  })
}

// ---------------------------------------------------------------- viewer

function useBridge(ref, art, ctx) {
  useEffect(() => {
    if (!art) return undefined
    const { id: aid, title } = art
    const onMessage = e => {
      const frame = ref.current
      if (!frame || e.source !== frame.contentWindow) return
      const d = e.data
      if (!d || d.__hermes_bridge !== 1 || d.kind !== 'hello') return
      const ch = new MessageChannel()
      ch.port1.onmessage = async ev => {
        const m = ev.data || {}
        const reply = r => ch.port1.postMessage({ id: m.id, ...r })
        try {
          if (m.op === 'callTool') return reply({ ok: false, error: 'callTool is not enabled in the desktop' })
          const gesture = navigator.userActivation?.isActive === true
          const value = await ctx.rest(`/artifacts/${encodeURIComponent(aid)}/op`, {
            method: 'POST',
            body: { op: m.op, args: m.args || {} }
          })
          if (m.op === 'send') {
            const text = `[artifact: ${title}] ${String(m.args?.text ?? '')}`
            const sid = host.state.activeSessionId.get()
            value.delivered = gesture ? host.composer.submit(sid, text) : await host.composer.setDraft(sid, text)
            value.mode = gesture ? 'submitted' : 'draft'
          }
          reply({ ok: true, value })
        } catch (err) {
          reply({ ok: false, error: String(err?.message || err) })
        }
      }
      frame.contentWindow.postMessage({ __hermes_bridge: 1, kind: 'port', v: 1 }, '*', [ch.port2])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [art?.id, art?.title])
}

function Viewer({ ctx }) {
  const t = usePluginI18n(ID)
  useValue($list)
  useValue($selected)
  const shown = useValue($shown)
  const nonce = useValue($nonce)
  const ref = useRef(null)
  const art = current()
  const [src, setSrc] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  useBridge(ref, art, ctx)

  const v = art ? (shown ?? art.version) : null
  useEffect(() => {
    if (!art) return undefined
    let live = true
    setSrc(null)
    setLoadErr(null)
    ctx
      .rest(`/artifacts/${encodeURIComponent(art.id)}/html?v=${v}`)
      .then(r => live && setSrc(toDataUrl(r.html)))
      .catch(err => live && setLoadErr(String(err?.message || err)))
    return () => {
      live = false
    }
  }, [art?.id, v, nonce])

  if (!art) {
    return jsx('div', { className: `flex flex-1 items-center justify-center ${muted}`, children: t('pick') })
  }

  return jsxs('section', {
    className: 'flex min-h-0 min-w-0 flex-1 flex-col',
    children: [
      jsxs('div', {
        className: 'flex h-9 shrink-0 items-center gap-2 border-b border-(--ui-stroke-secondary) px-3',
        children: [
          jsx('span', { className: 'min-w-0 flex-1 truncate text-sm text-foreground', children: art.title }),
          jsx('select', {
            className: 'h-6 rounded border border-(--ui-stroke-secondary) bg-transparent px-1 text-xs text-foreground',
            'aria-label': t('version'),
            value: String(v),
            onChange: e => {
              const n = Number(e.target.value)
              $shown.set(n === art.version ? null : n)
            },
            children: [...art.versions].reverse().map(n => jsx('option', { value: String(n), children: `v${n}` }, n))
          }),
          jsx('button', { type: 'button', className: ghostBtn, title: t('reload'), onClick: () => $nonce.set($nonce.get() + 1), children: '↻' })
        ]
      }),
      src
        ? jsx(SandboxedFrame, { key: `${art.id}:${v}:${nonce}`, ref, className: 'min-h-0 flex-1', sandbox: SANDBOX, src, title: art.title })
        : jsx('div', {
            className: `flex flex-1 items-center justify-center ${muted}`,
            children: loadErr ? t('loadFailed', loadErr) : t('loading')
          })
    ]
  })
}

function Page({ ctx }) {
  useEffect(() => {
    refresh(ctx)
  }, [])
  return jsxs('div', { className: 'flex h-full min-h-0', children: [jsx(ListColumn, { ctx }), jsx(Viewer, { ctx })] })
}

// ---------------------------------------------------------------- entry

/** Plain #/artifacts (sidebar row, keybind, palette) -> our page. #/artifacts?from=... stays: that is
 *  the built-in view opened from our link, and clicking the sidebar row there changes the hash back to
 *  plain #/artifacts, so the user is never stuck. */
let syncBack = () => {} // set in register(): titlebar back button while the built-in view is open

function redirectCore() {
  const h = window.location.hash
  if (h === `#${CORE}` || (h.startsWith(`#${CORE}?`) && h !== `#${CORE_KEEP}`)) window.location.replace(`#${PAGE}`)
  syncBack(window.location.hash === `#${CORE_KEEP}`)
}

export default {
  id: ID,
  name: 'Artifacts',
  description: 'Replaces the built-in Artifacts page with agent-published, versioned HTML artifacts and a sandboxed bridge.',
  register(ctx) {
    ctx.i18n.register(STRINGS)
    ctx.register({ id: 'page', area: ROUTES_AREA, title: 'Artifacts', data: { path: PAGE }, render: () => jsx(Page, { ctx }) })

    // Sidebar: swap the built-in Artifacts row for ours in the same slot, so it lights up on our page.
    // order 1000 = after other plugins' preferences (the skin's own nav order wins over ours).
    ctx.register({ id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: PAGE, label: 'Artifacts', codicon: 'files', tier: 'advanced' } })
    ctx.register({
      id: 'nav-prefs',
      area: SIDEBAR_NAV_PREFS_AREA,
      order: 1000,
      data: { hide: ['artifacts'], order: ['new-session', 'capabilities', 'messaging', `${ID}:nav`, 'cron'] }
    })

    // Titlebar back button (right cluster), registered only while the built-in view opened from our link
    // is shown and disposed right after. It goes in 'titleBar.tools.right' (TitlebarTool data), never in
    // TITLEBAR_AREAS: a non-empty titleBar.left/right slot means "this page owns the titlebar" and makes
    // Hermes hide its fixed controls on contributed pages.
    let disposeBack = null
    syncBack = show => {
      if (show === Boolean(disposeBack)) return
      if (!show) {
        disposeBack()
        disposeBack = null
        return
      }
      disposeBack = ctx.register({
        id: 'back',
        area: 'titleBar.tools.right',
        order: 0,
        data: {
          id: `${ID}-back`,
          label: ctx.i18n.t('back'),
          icon: jsx(Codicon, { name: 'arrow-left' }),
          onSelect: () => host.navigate(PAGE)
        }
      })
    }

    // Route changes: the app router uses history.pushState (no hashchange), so listen on the Navigation
    // API, which reports same-document entries too. One listener across hot reloads.
    const KEY = '__hermesArtifactsRedirect'
    const nav = window.navigation
    const prev = window[KEY]
    if (prev) {
      nav?.removeEventListener?.('currententrychange', prev)
      window.removeEventListener('hashchange', prev)
    }
    window[KEY] = redirectCore
    window.addEventListener('hashchange', redirectCore)
    if (nav?.addEventListener) nav.addEventListener('currententrychange', redirectCore)
    else ctx.setInterval(redirectCore, 250) // fallback for runtimes without the Navigation API
    redirectCore()

    ctx.onEvent(`plugin.${ID}.open`, async ev => {
      const p = payloadOf(ev)
      await refresh(ctx)
      if (p.id) select(ctx, p.id)
      host.navigate(PAGE)
    })
    ctx.setInterval(() => {
      if (window.location.hash.startsWith(`#${PAGE}`)) refresh(ctx)
    }, 5000)

    return () => {
      window.removeEventListener('hashchange', redirectCore)
      nav?.removeEventListener?.('currententrychange', redirectCore)
      if (window[KEY] === redirectCore) delete window[KEY]
      syncBack(false)
      syncBack = () => {}
    }
  }
}
