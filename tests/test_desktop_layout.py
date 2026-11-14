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
          const box = el => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width } }
          const out = []
          for (const v of %s) {
            M.$chat.set(v.chat); M.$dockPos.set(v.pos)
            for (let w = v.from; w <= 1600; w += 20) {
              root.style.width = w + 'px'
              R.mount(() => jsx(M.Header, { ctx: {}, art, v: v.ver, portRef: { current: null }, docked: v.docked }), root)
              %s
              const head = root.firstElementChild, title = head.querySelector('button[aria-haspopup=menu]'), span = title.querySelector('span')
              out.push({ name: v.name, w, head: box(head), title: box(title), span: { ...box(span), clipped: span.scrollWidth > span.clientWidth + 1, ellipsis: getComputedStyle(span).textOverflow },
                chev: box(title.querySelector('svg')), ver: title.querySelectorAll('span').length > 1 ? box(title.querySelectorAll('span')[1]) : null,
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
            const bar = root.querySelector('h1').nextElementSibling, [chips, tools] = bar.children
            out.push({ w, searching, bar: box(bar), chips: [...chips.children].map(box), tools: [...tools.children].map(c => ({ ...box(c), tag: c.tagName })) })
          }
          R.unmount()
          return out
        """ % (NEXT, NEXT))
        self.assertEqual(len(out), 122)
        for o in out:
            msg = f"toolbar at {o['w']} px{', searching' if o['searching'] else ''}"
            bar, tools, all_ = o["bar"], o["tools"], o["chips"] + o["tools"]
            self.assertEqual([t["tag"] for t in tools][0], "INPUT" if o["searching"] else "BUTTON", msg)
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
            if o["searching"]:
                self.assertGreaterEqual(tools[0]["w"], 160, msg)

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


class ListColsTests(unittest.TestCase):
    def test_columns_by_width(self):
        from test_desktop_plugin import NODE, run_node, stub_module
        if NODE is None:
            self.skipTest("node not installed")
        out = run_node(stub_module("\nexport { listCols }\n"), "console.log(JSON.stringify([0, 400, 559, 560, 719, 720, 1600].map(m.listCols)))")
        self.assertEqual(out, ["wide", "narrow", "narrow", "mid", "mid", "wide", "wide"])


if __name__ == "__main__":
    unittest.main()
