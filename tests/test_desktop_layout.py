"""The Desktop half's layout at every width, measured in headless Chrome (tests/_dom.py renders the real
components): the viewer's header with a 100-character title, the gallery's list rows and its toolbar, from 400 to
1600 px. Nothing overlaps, nothing has no width, nothing runs past the window: the 0.20 acceptance round saw the
title run through the header's buttons at 400 px and under Chat at 1000, list rows with titles 0 px wide, and the
New button alone on a row. Also: a closed menu or dialog gives the focus back. Skipped without Chrome or node."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _browser as B  # noqa: E402
import _dom as D

EXPORTS = ("\nexport { STRINGS, Header, Gallery, $list, $layout, $folders, $folder, $chat, $dockPos, $query, $trash, $trashOpen,"
           " listCols, HEADER_ICONS, TILE_MIN }\n")
LONG = ("A very long artifact title that must truncate with an ellipsis in the viewer header at every width" + "!" * 100)[:100]
NEXT = "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); R.flush();"


def cut(a, b):
    return a["l"] < b["r"] - 0.5 and b["l"] < a["r"] - 0.5 and a["t"] < b["b"] - 0.5 and b["t"] < a["b"] - 0.5


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class LayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = D.Page(EXPORTS)

    @classmethod
    def tearDownClass(cls):
        cls.page.close()

    def run_js(self, body):
        r = self.page.drive("await api.size(1700, 900);\nreturn await api.top(`(async () => {\n" + body + "\n})()`)")
        self.assertIsNone(r.get("err"), r.get("err"))
        self.assertEqual(r.get("logs") or [], [])
        return r["out"]

    def test_the_tile_is_never_wider_than_the_window(self):
        # Hermes puts a tile's minWidth on its zone's track (pane-shell track-model): a zone of 1 px share
        # beside a chat zone, in windows of 400 (expanded) to 1600 px.
        r = self.page.drive("""
          const out = []
          for (const w of [360, 400, 416, 600, 836, 1600]) {
            await api.size(w, 700)
            out.push(await api.top(`(() => { const row = document.createElement('div'); row.style.cssText = 'display:flex;width:100vw'
              const tile = document.createElement('div'); tile.style.cssText = 'flex:1 1 1px;min-width:' + H.M.TILE_MIN
              row.append(tile); document.body.append(row); const b = tile.getBoundingClientRect().width; row.remove(); return [innerWidth, b] })()`))
          }
          return out""")
        self.assertIsNone(r.get("err"), r)
        for win, tile in r["out"]:
            self.assertLessEqual(tile, win, (win, tile))  # expanded at 400 px: the window's width, not 416
            self.assertGreaterEqual(tile, min(416, win), (win, tile))  # beside a chat: still at least 26rem

    def test_the_header_at_every_width(self):
        variants = [
            {"name": "page", "chat": "off", "pos": "right", "docked": False, "ver": 3, "from": 400},
            {"name": "page, old version", "chat": "off", "pos": "right", "docked": False, "ver": 1, "from": 400},
            {"name": "page, chat popped out", "chat": "float", "pos": "right", "docked": False, "ver": 3, "from": 400},
            # the pane beside a chat is at least 26rem (openTile)
            {"name": "beside a chat", "chat": "split", "pos": "right", "docked": True, "ver": 3, "from": 416},
            {"name": "expanded over its chat", "chat": "split", "pos": "center", "docked": True, "ver": 3, "from": 416},
        ]
        out = self.run_js("""
          const { M, R, jsx } = window.H
          const root = document.getElementById('root')
          const art = { id: 'a1', title: %s, type: 'doc', version: 3, versions: [1, 2, 3], session: 's1' }
          const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height } }
          const out = []
          for (const v of %s) {
            M.$chat.set(v.chat); M.$dockPos.set(v.pos)
            for (let w = v.from; w <= 1600; w += 20) {
              root.style.width = w + 'px'
              R.mount(() => jsx(M.Header, { ctx: {}, art, v: v.ver, portRef: { current: null }, docked: v.docked }), root)
              %s
              const head = root.firstElementChild, title = head.querySelector('button[aria-haspopup=menu]'), span = title.querySelector('span')
              out.push({ name: v.name, w, head: box(head), title: box(title), span: { ...box(span), clipped: span.scrollWidth > span.clientWidth + 1, ellipsis: getComputedStyle(span).textOverflow },
                chev: box(title.querySelector('i.codicon')), ver: title.querySelectorAll('span').length > 1 ? box(title.querySelectorAll('span')[1]) : null,
                btns: [...head.querySelectorAll('button')].filter(b => b !== title).map(b => ({ label: b.getAttribute('aria-label'), text: b.textContent.trim(), ...box(b) })) })
            }
            R.unmount()
          }
          return { out, iconsBelow: M.HEADER_ICONS }
        """ % (json.dumps(LONG), json.dumps(variants), NEXT))
        below = out["iconsBelow"]
        self.assertEqual(len(out["out"]), 3 * 61 + 2 * 60)
        for o in out["out"]:
            msg = f"{o['name']} at {o['w']} px"
            head, title, btns = o["head"], o["title"], o["btns"]
            boxes = [title] + btns
            for b in boxes:
                self.assertGreater(b["w"], 0, msg)
                self.assertGreaterEqual(b["l"], head["l"] - 0.5, msg)
                self.assertLessEqual(b["r"], head["r"] + 0.5, msg)  # nothing past the header (the window's edge)
            for i, a in enumerate(boxes):
                for b in boxes[i + 1:]:
                    self.assertFalse(cut(a, b), f"{msg}: {a} over {b}")
            # Hermes' buttons in a pane's header (right-sidebar/index.tsx, Button size="icon-xs"): 24 px, an icon's
            # square; the title's too, all on one line (V6q: 30 x 30)
            for b in boxes:
                self.assertAlmostEqual(b["h"], 24, delta=0.5, msg=msg)
                self.assertAlmostEqual(b["t"], title["t"], delta=0.5, msg=msg)
            for b in btns:
                if not b["text"]:
                    self.assertAlmostEqual(b["w"], 24, delta=0.5, msg=f"{msg}: {b}")
            # the title gives way with a gap before the buttons, its chevron (and version) seen inside it
            self.assertLessEqual(title["r"] + 8, min(b["l"] for b in btns) + 0.5, msg)
            self.assertGreater(o["chev"]["w"], 0, msg)
            self.assertLessEqual(o["chev"]["r"], title["r"], msg)
            self.assertLessEqual(o["span"]["r"], o["chev"]["l"], msg)
            if o["ver"]:
                self.assertLessEqual(o["ver"]["r"], o["chev"]["l"], msg)
                self.assertGreaterEqual(o["ver"]["l"], o["span"]["r"], msg)
            self.assertGreaterEqual(o["span"]["w"], 40, msg)  # some of the title is always read
            if o["span"]["clipped"]:
                self.assertEqual(o["span"]["ellipsis"], "ellipsis", msg)
            # a labelled button shows its words only where the header has room for them
            for b in btns:
                if b["label"] in ("Chat", "Show chat"):
                    self.assertEqual(b["text"], "" if o["head"]["w"] < below else b["label"], msg)
        wide = [o for o in out["out"] if o["name"] == "page" and o["w"] == 1600][0]
        self.assertTrue(wide["span"]["clipped"])  # 100 characters are cut at 520 px even on a wide page

    def gallery(self, script):
        return self.run_js("""
          const { M, R, jsx } = window.H
          const root = document.getElementById('root')
          root.style.height = '900px'
          const now = Date.now() / 1000
          const a = (id, title, type, more = {}) => ({ id, title, type, version: 1, versions: [1], updated: now - 3600, opened: now - 60, ...more })
          M.$list.set([a('a1', %s, 'design-system', { pinned: true, comments: 12, folder: 'Quarterly reviews and audits' }),
            a('a2', 'Facade budget', 'sheet', { folder: 'Clients' }), a('a3', 'Building C: project brief', 'doc', { comments: 1 }),
            a('a4', 'Site visit checklist', 'page', { pinned: true }), a('a5', 'Harbor Lights', 'motion'), a('a6', 'Cassette panel', 'model')])
          M.$folders.set(['Clients', 'R1 folder', 'Quarterly reviews and audits']); M.$folder.set(null); M.$layout.set('list'); M.$query.set('')
          const ctx = { rest: async () => ({}), storage: { get: () => null, set() {} } }
          const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width } }
          %s
        """ % (json.dumps(LONG), script))

    def test_list_rows_at_every_width(self):
        out = self.gallery("""
          const out = []
          for (let w = 400; w <= 1600; w += 20) {
            root.style.width = w + 'px'
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            const rows = [...root.querySelectorAll('[role=button][tabindex="0"]')]
            out.push({ w, scroll: root.firstElementChild.firstElementChild.scrollWidth - root.firstElementChild.firstElementChild.clientWidth, rows: rows.map(r => ({ row: box(r),
              cells: [...r.children].map(c => ({ ...box(c), text: c.textContent.trim().slice(0, 30), title: c === r.children[1] })) })) })
          }
          R.unmount()
          return out
        """ % NEXT)
        self.assertEqual(len(out), 61)
        types = {"Design system", "Sheet", "Doc", "Page", "Motion", "3D model"}
        for o in out:
            msg = f"list at {o['w']} px"
            self.assertEqual(o["scroll"], 0, msg)  # no sideways scroll
            self.assertEqual(len(o["rows"]), 6, msg)
            type_x = set()
            for r in o["rows"]:
                row, cells = r["row"], r["cells"]
                self.assertLessEqual(row["r"], o["w"] + 0.5, msg)
                title = [c for c in cells if c["title"]][0]
                self.assertGreaterEqual(title["w"], 80, f"{msg}: the title has {title['w']} px")
                for c in cells:
                    self.assertGreaterEqual(c["l"], row["l"] - 0.5, msg)
                    self.assertLessEqual(c["r"], row["r"] + 0.5, msg)
                for i, a in enumerate(cells):
                    for b in cells[i + 1:]:
                        if a["w"] and b["w"]:
                            self.assertFalse(cut(a, b), f"{msg}: {a} over {b}")
                type_x |= {round(c["l"]) for c in cells if c["text"] in types}
            self.assertLessEqual(len(type_x), 1, f"{msg}: the type column starts at {type_x}")  # left-aligned, one x

    def test_the_toolbar_at_every_width(self):
        out = self.gallery("""
          const out = []
          for (const searching of [false, true]) for (let w = 400; w <= 1600; w += 20) {
            root.style.width = w + 'px'
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            if (searching && !root.querySelector('input')) { root.querySelector('button[aria-label="Search artifacts…"]').click(); %s }
            const bar = root.querySelector('h1').nextElementSibling, [chips, tools] = bar.children, input = root.querySelector('input')
            const sc = chips.firstElementChild
            out.push({ w, searching, bar: box(bar), chips: [box(chips)], tools: [...tools.children].map(c => ({ ...box(c), tag: c.tagName })),  // the chips' row (it scrolls)
              input: input && box(input), chipsCut: sc.scrollWidth > sc.clientWidth + 1 })
          }
          R.unmount()
          return out
        """ % (NEXT, NEXT))
        self.assertEqual(len(out), 122)
        for o in out:
            msg = f"toolbar at {o['w']} px{', searching' if o['searching'] else ''}"
            bar, tools, all_ = o["bar"], o["tools"], o["chips"] + o["tools"]
            # searching: the field on the toolbar where every folder chip stays whole beside it, else on its own row
            # under the toolbar, as wide as it (V6c at 406 px: the folders were 56 px, "All" alone; V6d: inline from a
            # fixed 560 px, a chip cut off behind it)
            inline = o["searching"] and tools[0]["tag"] == "INPUT"
            if not o["searching"]:
                self.assertEqual(tools[0]["tag"], "BUTTON", msg)
            if inline:
                self.assertFalse(o["chipsCut"], msg)
            if o["w"] >= 1200:
                self.assertEqual(inline, o["searching"], msg)  # room enough: on the toolbar's row
            if o["searching"]:
                self.assertGreaterEqual(o["chips"][0]["w"] if not inline else 150, 150, msg)
                if not inline:
                    self.assertGreaterEqual(o["input"]["t"], bar["b"], msg)
                    self.assertAlmostEqual(o["input"]["w"], bar["w"], delta=0.5, msg=msg)
            for b in all_:
                self.assertGreater(b["w"], 0, msg)
                self.assertGreaterEqual(b["l"], bar["l"] - 0.5, msg)
                self.assertLessEqual(b["r"], bar["r"] + 0.5, msg)
            for i, a in enumerate(all_):
                for b in all_[i + 1:]:
                    self.assertFalse(cut(a, b), f"{msg}: {a} over {b}")
            # the tools stay one row, right-aligned (on the folders' row, or whole on the next)
            self.assertEqual(len({round(t["t"]) for t in tools}), 1, msg)
            self.assertAlmostEqual(max(t["r"] for t in tools), bar["r"], delta=0.5, msg=msg)
            if inline:
                self.assertGreaterEqual(tools[0]["w"], 160, msg)

    def test_the_new_tiles_end_where_the_toolbar_ends(self):
        # Round V1 at 400 px: the "Make something new" tiles (136 px each, wrapped) ended at 314 px, the toolbar at 364.
        out = self.gallery("""
          const out = []
          for (let w = 400; w <= 1600; w += 40) {
            root.style.width = w + 'px'
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            const bar = root.querySelector('h1').nextElementSibling
            const grid = [...root.querySelectorAll('div')].find(d => d.textContent === 'Make something new').nextElementSibling
            const tiles = [...grid.children].map(c => box(c.querySelector('button').firstElementChild))
            out.push({ w, bar: box(bar), tiles })
          }
          R.unmount()
          return out
        """ % NEXT)
        for o in out:
            first = [t for t in o["tiles"] if abs(t["t"] - o["tiles"][0]["t"]) < 1]
            self.assertGreaterEqual(min(t["w"] for t in o["tiles"]), 136, o["w"])
            self.assertAlmostEqual(first[0]["l"], o["bar"]["l"], delta=0.5, msg=o["w"])
            if len(first) < len(o["tiles"]):  # a full first row: its last tile ends with the toolbar
                self.assertAlmostEqual(first[-1]["r"], o["bar"]["r"], delta=1, msg=o["w"])

    def test_a_long_folder_name_keeps_the_chips_on_one_row(self):
        # V5 at 400 px: a 39-character folder, shown, put All, its chip and Trash on three lines: its chip is cut
        # (the whole name in its tooltip), the chips one row, the tools the next
        name = "Quarterly reports 2026 long folder name"
        out = self.gallery("""
          M.$folders.set([%s]); M.$folder.set(%s)
          M.$trash.set([1, 2, 3, 4, 5, 6].map(i => ({ name: 't' + i, id: 't' + i, title: 'Gone ' + i, type: 'doc', deleted_at: now - 120, days_left: 30 })))
          const out = []
          for (const w of [400, 480, 560]) {
            root.style.width = w + 'px'
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            const bar = root.querySelector('h1').nextElementSibling, [chips, tools] = bar.children, all = [...chips.querySelectorAll('button')]
            const label = [...chips.querySelectorAll('span')].find(s => s.textContent === %s)
            out.push({ w, chipTops: [...new Set(all.map(c => Math.round(c.getBoundingClientRect().top)))], toolsTop: Math.round(tools.getBoundingClientRect().top),
                       cut: label.scrollWidth > label.clientWidth, tip: label.title, n: all.length })
          }
          R.unmount()
          return out
        """ % (json.dumps(name), json.dumps(name), NEXT, json.dumps(name)))
        for o in out:
            self.assertEqual(o["n"], 3, o)  # All, the long one, Trash
            self.assertEqual(len(o["chipTops"]), 1, o)  # one row of chips
            self.assertGreaterEqual(o["toolsTop"], o["chipTops"][0], o)  # the tools on it or the next: two lines at most
            self.assertEqual(o["tip"], name, o)
        self.assertTrue(out[0]["cut"], out[0])  # cut with an ellipsis at 400

    def test_a_narrow_trash_keeps_when_and_how_long_under_each_title(self):
        # V5 at 400 px: the trash rows showed neither "Deleted 2m" nor "30 days left" (both were cells dropped there)
        out = self.gallery("""
          M.$trash.set([{ name: 't1', id: 't1', title: 'Gone for now', type: 'doc', deleted_at: now - 120, days_left: 30 }]); M.$trashOpen.set(true)
          const out = {}
          for (const w of [400, 1500]) {
            root.style.width = w + 'px'
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            out[w] = [...root.querySelectorAll('div, span')].filter(e => e.children.length === 0 || [...e.childNodes].some(n => n.nodeType === 3)).map(e => e.textContent).filter(t => /days left|Deleted/.test(t))
          }
          R.unmount(); M.$trashOpen.set(false)
          return out
        """ % NEXT)
        for w in ("400", "1500"):
            text = " ".join(out[w])
            self.assertIn("30 days left", text, (w, out))
            self.assertIn("Deleted 2m", text, (w, out))

    def test_a_search_with_no_result_says_nothing_matches_with_clear_search(self):
        # V6a: "0 of 22 match "zzqx" · Clear search" over an empty area
        out = self.gallery("""
          root.style.width = '1200px'
          M.$query.set('zzqx')
          R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
          %s
          const empty = [...root.querySelectorAll('div')].find(d => d.textContent === 'Nothing matches.')
          const wrap = empty && empty.parentElement, r = wrap && wrap.getBoundingClientRect(), t = empty && empty.getBoundingClientRect()
          const out = { empty: !!empty, clear: [...root.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Clear search').length,
                        centred: !!empty && Math.abs((t.left + t.right) / 2 - (r.left + r.right) / 2) < 2, note: /match “zzqx”/.test(root.textContent) }
          R.unmount(); M.$query.set('')
          return out
        """ % NEXT)
        self.assertEqual(out, {"empty": True, "clear": 1, "centred": True, "note": False})

    def test_a_closed_menu_or_dialog_gives_the_focus_back(self):
        out = self.gallery("""
          root.style.width = '1200px'
          R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
          %s
          const row = () => [...root.querySelectorAll('[role=button][tabindex="0"]')].find(r => r.textContent.includes('Facade budget'))
          const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
          const out = {}
          // Move to (M on the row): its search field takes the focus; Esc closes it
          row().focus(); key(row(), 'm'); %s
          out.moveOpen = document.activeElement.tagName
          key(window, 'Escape'); %s
          out.afterMove = document.activeElement === row()
          // Rename (R on the row): its field; Esc there
          key(row(), 'r'); %s
          out.renameOpen = document.activeElement.tagName
          key(document.activeElement, 'Escape'); %s
          out.afterRename = document.activeElement === row()
          // the card menu by a right click, with the focus nowhere: back to its row
          document.activeElement.blur()
          row().parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); %s
          out.menuOpen = [...root.querySelectorAll('button')].some(b => b.textContent.startsWith('Rename'))
          key(window, 'Escape'); %s
          out.afterMenu = document.activeElement === row()
          R.unmount()
          return out
        """ % ((NEXT,) * 7))
        self.assertEqual(out, {"moveOpen": "INPUT", "afterMove": True, "renameOpen": "INPUT", "afterRename": True,
                               "menuOpen": True, "afterMenu": True})

    def test_move_to_a_new_folder_with_enter_closes_the_whole_menu(self):
        # V6a: Move to › a new name › Enter moved the card, and its menu came back over it (the press, its focus
        # back on the ••• button, clicked that too)
        setup = """(() => { const { M, R, jsx } = window.H, root = document.getElementById('root'); root.style.width = '1200px'; root.style.height = '900px'
          const now = Date.now() / 1000
          M.$list.set([{ id: 'a2', title: 'Facade budget', type: 'sheet', version: 1, versions: [1], updated: now - 3600 }]); M.$folders.set([]); M.$folder.set(null); M.$layout.set('grid'); M.$query.set('')
          window.__rests = []
          const ctx = { rest: async (url, o) => (window.__rests.push(url), {}), storage: { get: () => null, set() {} } }
          R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root) })()"""
        at = lambda js: "(() => { const b = %s; if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()" % js
        card = "[...document.querySelectorAll('[role=button][tabindex=\"0\"]')].find(r => r.textContent.includes('Facade budget'))"
        js = {k: json.dumps(v) for k, v in {"setup": setup, "card": at(card), "more": at(card + ".parentElement.querySelector('button[title^=\"More\"]')"),
                                             "move": at("[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Move to'))")}.items()}
        r = self.page.drive(f"""
          await api.size(1300, 900); await api.top({js["setup"]}); await api.sleep(300)
          const c = await api.top({js["card"]}); await api.mouse(c[0], c[1] - 40); await api.sleep(200)  // hover: its ••• button
          const more = await api.top({js["more"]}); await api.mouse(more[0], more[1]); await api.sleep(300)
          const mv = await api.top({js["move"]}); await api.mouse(mv[0], mv[1]); await api.sleep(300)
          await api.type('Brand new'); await api.sleep(200); await api.press('Enter', 'Enter', 13, '\\r'); await api.sleep(600)
          return {{ menu: await api.top("[...document.querySelectorAll('button')].some(b => /^(Rename|Move to)/.test(b.textContent))"), made: await api.top('window.__rests.some(u => u === "/folders")') }}""")
        self.assertIsNone(r.get("err"), r)
        self.assertEqual(r["out"], {"menu": False, "made": True})

    def test_card_keys_after_a_mouse_opened_menu_and_the_menu_at_the_pointer(self):
        out = self.gallery("""
          root.style.width = '1200px'
          const rests = []
          ctx.rest = async (url, o) => (rests.push(url + ' ' + JSON.stringify(o && o.body || null)), {})
          const out = {}, L = M.$list.get()
          for (const layout of ['grid', 'list']) {
            M.$layout.set(layout)
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            const card = () => [...root.querySelectorAll('[role=button][tabindex="0"]')].find(r => r.textContent.includes('Facade budget'))
            const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
            card().parentElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); card().parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); %s
            const more = card().parentElement.querySelector('button[title^="More"]') || [...card().parentElement.querySelectorAll('button')].find(b => /More|moreFor/.test(b.title))
            more.focus(); more.click(); %s
            const open = [...root.querySelectorAll('button')].some(b => b.textContent.startsWith('Rename'))
            key(window, 'Escape'); %s
            const back = document.activeElement === more
            rests.length = 0
            key(document.activeElement, 'p'); %s  // P on the ••• button: pin
            const pinned = rests.some(r => r.includes('"pinned":true'))
            M.$list.set(L); %s  // the stub's answers emptied the list
            // a right click: the menu where the pointer is, not at the ••• button
            const r0 = card().getBoundingClientRect()
            card().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r0.left + 60, clientY: r0.top + 30 })); %s
            const rename = [...root.querySelectorAll('button')].find(b => b.textContent.startsWith('Rename'))
            const m = rename && rename.parentElement.getBoundingClientRect()
            out[layout] = { open, back, pinned, trigger: card().parentElement.hasAttribute('data-hermes-context-menu-trigger'),
              at: m ? [Math.round(m.left - r0.left), Math.round(m.top - r0.top)] : null }
            key(window, 'Escape'); %s
            R.unmount()
          }
          return out
        """ % ((NEXT,) * 8))
        for layout in ("grid", "list"):
            o = out[layout]
            self.assertEqual((o["open"], o["back"], o["pinned"], o["trigger"]), (True, True, True, True), (layout, o))
            self.assertLessEqual(abs(o["at"][0] - 60), 8, (layout, o))  # at the pointer (within the menu's fit)
            self.assertLessEqual(abs(o["at"][1] - 30), 8, (layout, o))


    # Live round V6.
    def test_the_folder_name_refusal_is_read_whole_in_move_to(self):
        # V6: "A folder name is at most 40 chara…" in Move to's 280 px menu
        out = self.gallery("""
          const out = {}
          for (const lang of ['en', 'hu']) for (const w of [400, 1200]) {
            window.__STRINGS = M.STRINGS[lang]; root.style.width = w + 'px'
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            const row = [...root.querySelectorAll('[role=button][tabindex="0"]')].find(r => r.textContent.includes('Facade budget'))
            row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true })); %s
            const input = document.activeElement
            input.value = 'A folder name that is longer than forty characters'; input.dispatchEvent(new Event('input', { bubbles: true })); %s
            const said = M.STRINGS[lang].folderTooLong(40)
            const b = [...root.querySelectorAll('button')].find(x => x.textContent === said), span = b && b.querySelector('span span')
            const menu = b && b.parentElement.getBoundingClientRect(), r = span && span.getBoundingClientRect()
            out[lang + w] = span ? { cut: span.scrollWidth > span.clientWidth + 1 || span.scrollHeight > span.clientHeight + 1 || getComputedStyle(span).textOverflow === 'ellipsis',
              inside: r.left >= menu.left && r.right <= menu.right + 0.5 } : null
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); %s
            R.unmount()
          }
          window.__STRINGS = M.STRINGS.en
          return out
        """ % ((NEXT,) * 4))
        self.assertEqual(out, {k: {"cut": False, "inside": True} for k in ("en400", "en1200", "hu400", "hu1200")})

    def test_folder_chips_one_row_each_at_most_its_cap_and_the_tools_never_wrap(self):
        # V6 at ~406 px: four folders (one long) put the chips on two rows and the tools on a third; the long chip
        # was 188 px for a 160 px cap
        long_name = "Quarterly review of the northern region"
        out = self.gallery("""
          const out = []
          for (const n of [1, 4, 12]) for (const w of [400, 406, 440, 480]) for (const searching of [false, true]) {
            const names = [%s, 'Alpha', 'Beta', 'Gamma', ...Array.from({ length: 8 }, (_, i) => 'Folder ' + (i + 1))].slice(0, n)
            M.$folders.set(names); M.$folder.set(names[0]); M.$query.set(searching ? 'a' : '')
            M.$trash.set([1, 2, 3, 4, 5, 6].map(i => ({ name: 't' + i, id: 't' + i, title: 'Gone ' + i, type: 'doc', deleted_at: now - 120, days_left: 30 })))
            root.style.width = w + 'px'
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            if (searching && !root.querySelector('input')) { root.querySelector('button[aria-label="Search artifacts…"]').click(); %s }
            const bar = root.querySelector('h1').nextElementSibling, b = bar.getBoundingClientRect()
            const chips = [...bar.firstElementChild.querySelectorAll('button')].map(c => c.getBoundingClientRect())
            const tools = [...bar.lastElementChild.children].map(c => c.getBoundingClientRect())
            const longChip = [...bar.firstElementChild.querySelectorAll('button')].find(c => c.textContent === %s)
            out.push({ n, w, searching, barH: b.height, chipTops: [...new Set(chips.map(c => Math.round(c.top)))], toolTops: [...new Set(tools.map(c => Math.round(c.top)))],
              toolsIn: tools.every(t => t.left >= b.left - 0.5 && t.right <= b.right + 0.5), longW: longChip ? longChip.getBoundingClientRect().width : 0,
              scrollbar: (() => { const s = bar.firstElementChild.firstElementChild; return s.offsetHeight - s.clientHeight })(), chipsW: bar.firstElementChild.getBoundingClientRect().width })
            R.unmount()
          }
          M.$query.set(''); M.$trash.set([])
          return out
        """ % (json.dumps(long_name), NEXT, NEXT, json.dumps(long_name)))
        for o in out:
            self.assertEqual(len(o["chipTops"]), 1, o)  # one row of chips
            self.assertEqual(o["toolTops"], o["chipTops"], o)  # the tools on the same row, never wrapped
            self.assertTrue(o["toolsIn"], o)
            self.assertLessEqual(o["barH"], 31, o)  # a single row
            self.assertLessEqual(o["longW"], 160 + 0.5, o)  # the whole chip within the cap
            self.assertEqual(o["scrollbar"], 0, o)  # no scrollbar under the chips
            if o["n"] >= 4:
                self.assertGreaterEqual(o["chipsW"], 150, o)  # V6c: searching at 406 px the folders had 56 px, "All" alone

    def test_a_search_shows_its_results_without_scrolling(self):
        # V6 at ~406 px: the results (and "Nothing matches.") sat under the eleven template tiles, at y ≈ 1008
        out = self.gallery("""
          root.style.height = '1000px'
          const out = {}
          for (const w of [406, 1200]) for (const q of ['facade', 'zzqx']) {
            M.$query.set(q); M.$layout.set('grid'); root.style.width = w + 'px'
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            const hit = [...root.querySelectorAll('div, span')].find(d => d.children.length === 0 && (d.textContent === 'Nothing matches.' || d.textContent === 'Facade budget'))
            out[q + w] = { top: hit ? Math.round(hit.getBoundingClientRect().top) : null, tiles: [...root.querySelectorAll('div')].some(d => d.textContent === 'Make something new') }
            R.unmount()
          }
          M.$query.set(''); root.style.height = '900px'
          return out
        """ % NEXT)
        for k, o in out.items():
            self.assertIsNotNone(o["top"], (k, out))
            self.assertLess(o["top"], 400, (k, out))  # in the first screen
            self.assertFalse(o["tiles"], (k, out))

    def test_the_search_field_is_inline_only_where_every_chip_stays_whole_beside_it(self):
        # V6d at ~900-980 px windows (a 600-700 px gallery): the field inline from a fixed 560 px, the Trash chip
        # cut off behind it with no fade over it. Inline only while all the chips are whole; else on its own row.
        out = self.gallery("""
          const out = []
          M.$folders.set(['Alpha', 'Beta', 'Gamma']); M.$folder.set(null)
          M.$trash.set([1, 2, 3].map(i => ({ name: 't' + i, id: 't' + i, title: 'Gone ' + i, type: 'doc', deleted_at: now - 120, days_left: 30 })))
          for (const w of [406, 560, 600, 650, 690, 720, 800, 1000, 1200]) {
            M.$query.set(''); root.style.width = w + 'px'
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            root.querySelector('button[aria-label="Search artifacts…"]').click(); %s
            const bar = root.querySelector('[data-chip-bar]'), sc = bar.firstElementChild.getBoundingClientRect(), f = root.querySelector('input').getBoundingClientRect()
            const chips = [...bar.querySelectorAll('button')].map(c => { const r = c.getBoundingClientRect(); return { t: c.textContent, l: r.left, r: r.right } })
            out.push({ w, below: f.top >= bar.getBoundingClientRect().bottom, cut: chips.filter(c => c.l < sc.left - 0.5 || c.r > sc.right + 0.5).map(c => c.t),
              meet: chips.some(c => c.l < f.right && f.left < c.r) && f.top < bar.getBoundingClientRect().bottom })
            R.unmount()
          }
          M.$query.set(''); M.$trash.set([])
          return out
        """ % (NEXT, NEXT))
        for o in out:
            self.assertFalse(o["meet"], o)
            if not o["below"]:
                self.assertEqual(o["cut"], [], o)  # inline: every chip whole
        self.assertTrue(any(not o["below"] for o in out), out)  # wide: inline still
        self.assertTrue(any(o["below"] for o in out), out)

    # Live round V6c.
    def test_a_folder_chips_menu_shows_its_items_whole_and_esc_closes_it(self):
        # V6c at 406 and 1500 px: the folder chip's Rename / Delete folder menu was a 260 x 14 px sliver (max-height
        # 0: its room was measured inside the chips' scrolling row, which does not cut it), and Esc left it open
        names = ["Alpha", "Beta", "Gamma", "Quarterly review of the northern region", "Delta", "Epsilon"]
        setup = """(() => { const { M, R, jsx } = window.H, root = document.getElementById('root'); root.style.height = '100%%'
          const now = Date.now() / 1000
          M.$list.set([{ id: 'a2', title: 'Facade budget', type: 'sheet', version: 1, versions: [1], updated: now - 3600, folder: %s }])
          M.$folders.set(%s); M.$folder.set(%s); M.$layout.set('grid'); M.$query.set(''); M.$trash.set([])
          const ctx = { rest: async () => ({}), storage: { get: () => null, set() {} } }
          R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root) })()"""
        probe = """(() => { const items = [...document.querySelectorAll('button')].filter(b => /^(Rename|Delete folder)/.test(b.textContent.trim()))
          if (!items.length) return null
          const menu = items[0].parentElement, m = menu.getBoundingClientRect()
          // seen, not cut by an ancestor's overflow: each corner of an item (2 px in) shows that item
          const seen = i => { const r = i.getBoundingClientRect(); return [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]]
            .every(([x, y]) => { const e = document.elementFromPoint(x, y); return !!e && i.contains(e) }) }
          return { menu: [m.left, m.top, m.right, m.bottom], items: items.map(i => { const r = i.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom] }),
            scroll: menu.scrollHeight - menu.clientHeight, seen: items.map(seen), win: [innerWidth, innerHeight] } })()"""
        chip = ("(() => { const b = document.querySelector('button[aria-haspopup=\"menu\"]');"  # the folder shown: its chevron opens its menu
                " const r = b.getBoundingClientRect(); return [r.right - 12, r.top + r.height / 2] })()")
        for w in (406, 1500):
            for shown in (names[0], names[3], names[5]):
                r = self.page.drive(f"""
                  await api.size({w}, 900); await api.top({json.dumps(setup % (json.dumps(shown), json.dumps(names), json.dumps(shown)))}); await api.sleep(400)
                  const c = await api.top({json.dumps(chip)}); await api.sleep(200); await api.mouse(c[0], c[1]); await api.sleep(400)
                  const open = await api.top({json.dumps(probe)})
                  await api.key('Escape', 'Escape', 27); await api.sleep(300)
                  return {{ open, after: await api.top({json.dumps(probe)}) }}""")
                self.assertIsNone(r.get("err"), r)
                o, msg = r["out"]["open"], (w, shown, r["out"])
                self.assertIsNotNone(o, msg)
                m = o["menu"]
                self.assertGreater(m[3] - m[1], 60, msg)  # not a sliver
                self.assertEqual(o["scroll"], 0, msg)  # nothing of it scrolled away
                for it in o["items"]:  # each item whole inside the menu, the window and what clips it
                    self.assertGreater(it[3] - it[1], 20, msg)
                    self.assertTrue(m[0] - 0.5 <= it[0] and it[2] <= m[2] + 0.5 and m[1] - 0.5 <= it[1] and it[3] <= m[3] + 0.5, msg)
                    self.assertTrue(0 <= it[0] and it[2] <= o["win"][0] and 0 <= it[1] and it[3] <= o["win"][1], msg)
                self.assertEqual(o["seen"], [True] * len(o["items"]), msg)
                self.assertIsNone(r["out"]["after"], msg)  # Esc closed it


    def test_the_folder_delete_confirm_counts_what_the_folder_holds(self):
        # V6d asked once more: "The artifact in it moves to No folder" with a folder holding one; two and three say so
        setup = """(() => { const { M, R, jsx } = window.H, root = document.getElementById('root'); root.style.height = '100%%'; root.style.width = ''
          const now = Date.now() / 1000, a = (id, folder) => ({ id, title: 'Item ' + id, type: 'doc', version: 1, versions: [1], updated: now - 60, folder })
          M.$list.set([a('1', 'Alpha'), a('2', 'Alpha'), a('3', 'Beta'), a('4', 'Gamma'), a('5', 'Gamma'), a('6', 'Gamma'), a('7', null)])
          M.$folders.set(['Alpha', 'Beta', 'Gamma']); M.$folder.set(%s); M.$layout.set('grid'); M.$query.set(''); M.$trash.set([])
          const ctx = { rest: async () => ({}), storage: { get: () => null, set() {} } }
          R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root) })()"""
        chip = ("(() => { const b = document.querySelector('button[aria-haspopup=\"menu\"]');"
                " const r = b.getBoundingClientRect(); return [r.right - 12, r.top + r.height / 2] })()")
        item = "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('Delete folder')); const r = b.getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2] })()"
        said = "[...document.querySelectorAll('button')].filter(x => /No folder/.test(x.textContent)).map(x => x.textContent)"
        out = {}
        for name in ("Alpha", "Beta", "Gamma"):
            r = self.page.drive(f"""
              await api.size(1500, 900); await api.top({json.dumps(setup % json.dumps(name))}); await api.sleep(400)
              const c = await api.top({json.dumps(chip)}); await api.mouse(c[0], c[1]); await api.sleep(400)
              const i = await api.top({json.dumps(item)}); await api.mouse(i[0], i[1]); await api.sleep(300)
              return await api.top({json.dumps(said)})""")
            self.assertIsNone(r.get("err"), r)
            out[name] = r["out"]
        self.assertTrue(any("The 2 artifacts in it move to No folder" in s for s in out["Alpha"]), out)
        self.assertTrue(any("The artifact in it moves to No folder" in s for s in out["Beta"]), out)
        self.assertTrue(any("The 3 artifacts in it move to No folder" in s for s in out["Gamma"]), out)

    def test_a_press_that_closes_a_menu_activates_nothing_under_it(self):
        # V6d: the folder chip's menu open, a click on a template tile closed the menu AND started a new chat
        setup = """(() => { const { M, R, jsx } = window.H, root = document.getElementById('root'); root.style.height = '100%%'; root.style.width = ''
          M.$list.set([]); M.$folders.set(['Alpha', 'Beta']); M.$folder.set('Alpha'); M.$layout.set('grid'); M.$query.set(''); M.$trash.set([])
          window.__newChats = 0
          const ctx = { rest: async () => ({}), storage: { get: () => null, set() {} } }
          R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root) })()"""
        chip = ("(() => { const b = document.querySelector('button[aria-haspopup=\"menu\"]');"
                " const r = b.getBoundingClientRect(); return [r.right - 12, r.top + r.height / 2] })()")
        # a tile's picture clear of the open menu (the menu: the box holding Rename)
        tile = """(() => { const items = [...document.querySelectorAll('button')].filter(b => /^Rename/.test(b.textContent.trim())); const m = items.length ? items[0].parentElement.getBoundingClientRect() : null
          const t = [...document.querySelectorAll('button')].filter(b => ['Docs', 'Sheets', 'Slides', 'Design', '3D', 'Motion', 'Whiteboard', 'Dashboard'].includes(b.textContent))
            .map(b => b.firstElementChild.getBoundingClientRect()).find(r => r.width && r.bottom < innerHeight && (!m || r.right < m.left || m.right < r.left || r.bottom < m.top || m.bottom < r.top))
          return t ? [t.left + t.width / 2, t.top + t.height / 2] : null })()"""
        menu = "[...document.querySelectorAll('button')].some(b => /^Rename/.test(b.textContent.trim()))"
        for w in (406, 1500):
            r = self.page.drive(f"""
              await api.size({w}, 900); await api.top({json.dumps(setup)}); await api.sleep(400)
              const c = await api.top({json.dumps(chip)}); await api.mouse(c[0], c[1]); await api.sleep(400)
              const o = {{ open: await api.top({json.dumps(menu)}) }}
              const t = await api.top({json.dumps(tile)}); o.tile = !!t
              await api.mouse(t[0], t[1]); await api.sleep(400)
              o.closed = !(await api.top({json.dumps(menu)})); o.chats = await api.top('window.__newChats')
              await api.mouse(t[0], t[1]); await api.sleep(400); o.chatsAfter = await api.top('window.__newChats')  // the menu gone, a click starts one
              return o""")
            self.assertIsNone(r.get("err"), r)
            self.assertEqual(r["out"], {"open": True, "tile": True, "closed": True, "chats": 0, "chatsAfter": 1}, w)

    def test_the_press_that_closes_a_menu_shows_no_tooltip_until_the_pointer_moves(self):
        # V6e: the folder chip's menu open, a press on a template tile closed it and that tile's tooltip came up at
        # once: the swallowed press (and the move to it, made under the menu) is no move onto the tile
        setup = """(() => { const { M, R, jsx } = window.H, root = document.getElementById('root'); root.style.height = '100%%'; root.style.width = ''
          M.$list.set([]); M.$folders.set(['Alpha', 'Beta']); M.$folder.set('Alpha'); M.$layout.set('grid'); M.$query.set(''); M.$trash.set([])
          const ctx = { rest: async () => ({}), storage: { get: () => null, set() {} } }
          R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root) })()"""
        chip = ("(() => { const b = document.querySelector('button[aria-haspopup=\"menu\"]');"
                " const r = b.getBoundingClientRect(); return [r.right - 12, r.top + r.height / 2] })()")
        tile = """(() => { const items = [...document.querySelectorAll('button')].filter(b => /^Rename/.test(b.textContent.trim())); const m = items.length ? items[0].parentElement.getBoundingClientRect() : null
          const t = [...document.querySelectorAll('button')].filter(b => ['Docs', 'Sheets', 'Slides', 'Design', '3D', 'Motion', 'Whiteboard', 'Dashboard'].includes(b.textContent))
            .map(b => b.firstElementChild.getBoundingClientRect()).find(r => r.width && r.bottom < innerHeight && (!m || r.right < m.left || m.right < r.left || r.bottom < m.top || m.bottom < r.top))
          return t ? [t.left + t.width / 2, t.top + t.height / 2] : null })()"""
        tips = "document.querySelectorAll('[role=tooltip]').length"
        for w in (406, 1500):
            r = self.page.drive(f"""
              await api.size({w}, 900); await api.top({json.dumps(setup)}); await api.sleep(400)
              const c = await api.top({json.dumps(chip)}); await api.mouse(c[0], c[1]); await api.sleep(400)
              const t = await api.top({json.dumps(tile)})
              await api.pointer('mouseMoved', t[0] - 6, t[1]); await api.sleep(150); const o = {{ underMenu: await api.top({json.dumps(tips)}) }}
              await api.mouse(t[0], t[1]); await api.sleep(500); o.closed = await api.top({json.dumps(tips)})
              await api.pointer('mouseMoved', t[0] + 4, t[1] + 2); await api.sleep(300); o.moved = await api.top({json.dumps(tips)})
              return o""")
            self.assertIsNone(r.get("err"), r)
            self.assertEqual(r["out"], {"underMenu": 0, "closed": 0, "moved": 1}, w)

    def test_the_chip_shown_is_scrolled_clear_of_the_faded_ends(self):
        # V6c at 406 px: the chosen chip ("Q…") was scrolled flush to the row's end, under its 24 px fade
        names = ["Alpha", "Beta", "Gamma", "Quarterly review of the northern region", *[f"Folder {i}" for i in range(1, 9)]]
        out = self.gallery("""
          const names = %s, out = []
          M.$folders.set(names); M.$trash.set([])
          for (const w of [400, 406, 480]) {
            root.style.width = w + 'px'; M.$folder.set(null)
            R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root)
            %s
            for (const n of [names[11], names[3], names[0], names[7], names[11]]) {
              M.$folder.set(n); %s
              const row = root.querySelector('[data-chip-bar]').firstElementChild, s = row.getBoundingClientRect()
              const c = [...row.querySelectorAll('button')].find(b => b.textContent === n).getBoundingClientRect()
              out.push({ w, n, l: c.left - s.left, r: s.right - c.right, start: row.scrollLeft <= 1, end: row.scrollLeft + row.clientWidth >= row.scrollWidth - 1, wide: c.width > s.width - 48 })
            }
            R.unmount()
          }
          M.$folder.set(null)
          return out
        """ % (json.dumps(names), NEXT, NEXT))
        for o in out:
            if o["wide"]:  # too wide for the room between the fades: centred
                self.assertAlmostEqual(o["l"], o["r"], delta=1, msg=o)
                continue
            self.assertGreaterEqual(o["l"], -0.5 if o["start"] else 24 - 0.5, o)  # clear of the left fade (none at the start)
            self.assertGreaterEqual(o["r"], -0.5 if o["end"] else 24 - 0.5, o)


    def test_a_tiles_tooltip_goes_when_the_pointer_is_no_longer_on_it(self):
        # V6c at 406 px: the 3D tile's tooltip stayed up after a wheel turned over the folder chips (no mouseleave
        # comes for a wheel, a scroll or a window that loses the pointer)
        setup = """(() => { const { M, R, jsx } = window.H, root = document.getElementById('root'); root.style.height = '900px'; root.style.width = '406px'
          M.$list.set([]); M.$folders.set(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta']); M.$folder.set(null); M.$query.set(''); M.$trash.set([])
          const ctx = { rest: async () => ({}), storage: { get: () => null, set() {} } }
          R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root) })()"""
        at = lambda js: "(() => { const b = %s; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()" % js
        tile = at("[...document.querySelectorAll('button')].find(b => b.textContent === '3D').firstElementChild")
        chips = at("document.querySelector('[data-chip-bar]')")
        # the 3D tile's tooltip up (another tile's, now under a pointer that did not move, may be)
        tip = "[...document.querySelectorAll('[role=tooltip]')].some(t => t.parentElement.textContent.startsWith('3D'))"
        r = self.page.drive(f"""
          await api.size(406, 900); await api.top({json.dumps(setup)}); await api.sleep(400)
          const hover = async () => {{ const t = await api.top({json.dumps(tile)}); await api.pointer('mouseMoved', 2, 2); await api.sleep(100); await api.pointer('mouseMoved', t[0], t[1]); await api.sleep(250); return api.top({json.dumps(tip)}) }}
          const o = {{ shown: await hover() }}
          const c = await api.top({json.dumps(chips)}); await api.wheel(c[0], c[1], 0, 120); await api.sleep(300); o.wheel = await api.top({json.dumps(tip)})
          o.shownAgain = await hover()
          await api.top('document.getElementById("root").firstElementChild.firstElementChild.scrollTop += 200'); await api.sleep(300)
          o.scroll = await api.top({json.dumps(tip)}); o.scrolled = await api.top('document.getElementById("root").firstElementChild.firstElementChild.scrollTop > 0')
          await api.top('window.scrollTo(0, 0); document.getElementById("root").firstElementChild.firstElementChild.scrollTop = 0'); await api.sleep(200)
          o.shownThird = await hover()
          await api.top('window.dispatchEvent(new Event("blur"))'); await api.sleep(200); o.blur = await api.top({json.dumps(tip)})
          return o""")
        self.assertIsNone(r.get("err"), r)
        self.assertEqual(r["out"], {"shown": True, "wheel": False, "shownAgain": True, "scroll": False, "scrolled": True, "shownThird": True, "blur": False})

    def test_a_tile_brought_under_a_still_pointer_shows_no_tooltip_until_the_pointer_moves(self):
        # V6d at 406 px: a 60 px scroll put another tile under the pointer and its tooltip showed within 100 ms, the
        # pointer never moved (the browser's own mouseenter after a scroll)
        setup = """(() => { const { M, R, jsx } = window.H, root = document.getElementById('root'); root.style.height = '900px'; root.style.width = '406px'
          M.$list.set([]); M.$folders.set([]); M.$folder.set(null); M.$query.set(''); M.$trash.set([])
          const ctx = { rest: async () => ({}), storage: { get: () => null, set() {} } }
          R.mount(() => jsx(M.Gallery, { ctx, pageRef: { current: null } }), root) })()"""
        # a point on the 3D tile's picture that, the list scrolled as far as it goes (at most a row), is on the picture of
        # the tile under it: [x, y, the scroll]
        where = """(() => { const s = document.getElementById('root').firstElementChild.firstElementChild
          const pic = n => [...document.querySelectorAll('button')].find(b => b.textContent === n).firstElementChild.getBoundingClientRect()
          const a = pic('3D'), b = [...document.querySelectorAll('button')].filter(x => x.firstElementChild && x.firstElementChild.style.height === '96px').map(x => x.firstElementChild.getBoundingClientRect())
            .find(r => Math.abs(r.left - a.left) < 1 && r.top > a.bottom)
          if (!b) return null
          const d = Math.min(b.top - a.top, s.scrollHeight - s.clientHeight - s.scrollTop), lo = Math.max(a.top, b.top - d), hi = Math.min(a.bottom, b.bottom - d)
          return hi - lo > 10 ? [a.left + a.width / 2, (lo + hi) / 2, d] : null })()"""
        tips = "[...document.querySelectorAll('[role=tooltip]')].map(t => t.parentElement.textContent.slice(0, 12))"
        scroller = 'document.getElementById("root").firstElementChild.firstElementChild'
        r = self.page.drive(f"""
          await api.size(406, 900); await api.top({json.dumps(setup)}); await api.sleep(400)
          const p = await api.top({json.dumps(where)}); const o = {{ found: !!p }}
          await api.pointer('mouseMoved', 2, 2); await api.sleep(100); await api.pointer('mouseMoved', p[0], p[1]); await api.sleep(250)
          o.first = await api.top({json.dumps(tips)})
          await api.top('{scroller}.scrollTop += ' + p[2]); await api.sleep(400)
          o.scrolled = await api.top({json.dumps(tips)})
          await api.pointer('mouseMoved', p[0] + 3, p[1] + 2); await api.sleep(250)
          o.moved = await api.top({json.dumps(tips)})
          return o""")
        self.assertIsNone(r.get("err"), r)
        o = r["out"]
        self.assertTrue(o["found"], o)
        self.assertEqual(len(o["first"]), 1, o)
        self.assertEqual(o["scrolled"], [], o)  # the tile now under the still pointer: no tooltip
        self.assertEqual(len(o["moved"]), 1, o)
        self.assertNotEqual(o["moved"], o["first"], o)  # a real move onto it: its own


class ListColsTests(unittest.TestCase):
    def test_columns_by_width(self):
        from test_desktop_plugin import NODE, run_node, stub_module
        if NODE is None:
            self.skipTest("node not installed")
        out = run_node(stub_module("\nexport { listCols }\n"), "console.log(JSON.stringify([0, 400, 559, 560, 719, 720, 1600].map(m.listCols)))")
        self.assertEqual(out, ["wide", "narrow", "narrow", "mid", "mid", "wide", "wide"])


if __name__ == "__main__":
    unittest.main()
