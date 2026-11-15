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

import _browser as B  # noqa: E402
from test_desktop_plugin import NODE, PLUGIN, run_node, stub_module  # noqa: E402

SRC = (PLUGIN / "desktop" / "plugin.js").read_text("utf-8")
EXPORTS = ("\nexport { STRINGS, fitPopup, placeCommentBox, PIN, COMMENT_W, errText, reuseSame, thumbKind, fetchVendor,"
           " copyText, $toast, filterCount, clearFilters, $types, $date, $pinnedOnly, $selected, C, refresh, $list, fetchDocument,"
           " shellCache, notifyArgs, PASS_OPS, GRACE_REFUSED, onPageEvent, $draft, noteGate, noteText, commentLayout, commentDocks,"
           " fetchHtml, htmlStamp, dropHtml, htmlCache, pinSpot, pickedRect, PIN_GAP, dateText, cardKey, CARD_KEYS,"
           " askedEdit, editOf, $popups, panelMode, panelStyle, VIEW_ROW, VIEW_FILL, FRAME_FIT, PANEL_W, STAGE_MIN,"
           " BOX_M, BOX_GAP, BOX_MIN_H, BAND_MIN, anchorTitle, $panel }\n")
NEW_KEYS = ["errStorage", "errDraining", "errOffline", "errGeneric", "errNoChat", "popInNoChat", "clearFilters",
            "clearFiltersTip", "noPreviewYet", "openComments", "editingBand", "copyWord", "discard", "noOpenComments",
            "noResolvedComments", "folderMore", "folderRename", "folderDelete", "folderDelConfirm", "folderDelConfirmSub",
            "folderDeleted", "searchNote", "clearSearch"]


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
        self.assertIn("commentLayout(draft.rect, bw, bh, boxH, cover)", section("function CommentPopover(", "function DockView("))


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

    def test_a_box_beside_a_control_keeps_its_gap_from_the_element(self):
        # V6c, a design's name strip picked at 1500 px (stage 1243 x 780, the page's own report): the box went beside
        # the Cupping strip, at x 487, flush on the artboard commented on (its right edge 486.58)
        rect = {"x": 73.43, "y": 160.83, "w": 413.15, "h": 555.17, "ly": 160.83, "lh": 24, "vt": 0, "vb": 780, "fr": False, "fl": True,
                "fa": True, "fb": True, "vis": True,
                "kp": [[73, 132, 487, 161], [512, 132, 639, 161], [664, 132, 790, 161], [815, 132, 1080, 161], [1105, 132, 1170, 161],
                       [12, 10, 74, 50], [1069, 10, 1231, 50], [496, 726, 747, 766]]}
        out = run_node(stub_module(EXPORTS), f"console.log(JSON.stringify(m.commentLayout({json.dumps(rect)}, 1243, 780, 141)))")
        b, p = out["box"], out["pin"]
        r = rect
        gap = max(r["x"] - (b["x"] + 320), b["x"] - (r["x"] + r["w"]), r["y"] - (b["y"] + 141), b["y"] - (r["y"] + r["h"]))
        self.assertGreaterEqual(gap, 8 - 0.01, out)
        if p:
            self.assertGreaterEqual(max(p["x"] - (b["x"] + 320), b["x"] - (p["x"] + 26), p["y"] - (b["y"] + 141), b["y"] - (p["y"] + 26)), 8 - 0.01, out)

    def test_a_pin_never_lies_on_the_pages_controls(self):
        # V6c, a design panned at 1500 px: the element's pin drew over the bottom palette's tools. V6f: it takes the
        # next free spot off them (above the element here); one with none is not drawn.
        body = """
        const kp = [[496, 726, 747, 766]]  // the palette
        const under = m.commentLayout({ x: 520, y: 720, w: 120, h: 40, ly: 720, lh: 20, vis: true, fr: true, fl: true, fa: true, fb: true, kp }, 1243, 780, 141)
        const clear = m.commentLayout({ x: 520, y: 300, w: 120, h: 40, ly: 300, lh: 20, vis: true, fr: true, fl: true, fa: true, fb: true, kp }, 1243, 780, 141)
        const none = m.commentLayout({ x: 520, y: 720, w: 120, h: 40, ly: 720, lh: 20, vis: true, fr: true, fl: true, fa: false, fb: false, kp }, 1243, 780, 141)
        console.log(JSON.stringify({ under: under.pin, clear: clear.pin, none: none.pin }))
        """
        out = run_node(stub_module(EXPORTS), body)
        u = out["under"]
        self.assertIsNotNone(u, out)  # beside the element is on the palette: above it
        self.assertFalse(u["x"] < 747 and 496 < u["x"] + 26 and u["y"] < 766 and 726 < u["y"] + 26, out)
        self.assertIsNotNone(out["clear"], out)
        self.assertIsNone(out["none"], out)  # its corner fallback is on the palette too: not drawn

    def test_near_every_edge_pin_and_box_stay_apart_and_inside(self):
        # The bridge's rect ends where the element's words end (a short line far left, a long one to the
        # right edge), at the top, the bottom, both sides and the corners of a pane and of the full page.
        body = """
        const out = []
        for (const [bw, bh] of [[1568, 860], [760, 640], [700, 520]]) {
          const rects = [{ x: 0, y: 0, w: 40, h: 20 }, { x: bw - 60, y: 0, w: 60, h: 20 }, { x: 0, y: bh - 20, w: 120, h: 20 },
            { x: bw - 200, y: bh - 24, w: 200, h: 24 }, { x: 20, y: bh / 2, w: bw - 40, h: 30 }, { x: bw / 2, y: 2, w: 10, h: 18 },
            { x: -30, y: -10, w: 80, h: 40 }, { x: bw - 10, y: bh + 5, w: 40, h: 20 }]
          for (const rect of rects) {
            for (const h0 of [120, 170, 260]) {
              const { pin, box } = m.placeCommentBox(rect, bw, bh, h0)
              const h = box.maxH ? Math.min(h0, box.maxH) : h0
              const apart = box.x >= pin.x + m.PIN || box.x + m.COMMENT_W <= pin.x || box.y >= pin.y + m.PIN || box.y + h <= pin.y
              const inside = box.x >= 0 && box.x + m.COMMENT_W <= bw && box.y >= 0 && box.y + h <= bh &&
                pin.x >= 0 && pin.x + m.PIN <= bw && pin.y >= 0 && pin.y + m.PIN <= bh
              if (!apart || !inside) out.push({ bw, bh, rect, h, pin, box, apart, inside })
            }
          }
        }
        console.log(JSON.stringify(out))
        """
        self.assertEqual(run_node(stub_module(EXPORTS), body), [])

    def test_the_pin_follows_its_element_and_the_text_stays(self):
        # The bridge sends the picked element's rect again when the page scrolls or the frame is resized.
        body = """
        const anchor = { selector: '#a', text: 'Next steps', label: 'h2' }
        m.$draft.set({ anchor, rect: { x: 600, y: 560, w: 120, h: 30 } })
        m.onPageEvent('picked-rect', { rect: { x: 600, y: 425, w: 120, h: 30 } })
        const moved = m.$draft.get()
        m.onPageEvent('picked-rect', { rect: { x: 'a', y: 1, w: 1, h: 1 } })
        const bad = m.$draft.get() === moved
        m.$draft.set(null)
        m.onPageEvent('picked-rect', { rect: { x: 1, y: 1, w: 1, h: 1 } })
        console.log(JSON.stringify({ rect: moved.rect, sameAnchor: moved.anchor === anchor, bad, none: m.$draft.get() }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out, {"rect": {"x": 600, "y": 425, "w": 120, "h": 30}, "sameAnchor": True, "bad": True, "none": None})
        # a new pick starts empty, as a selection's draft and a reply do ("Send to Hermes" is the checkbox)
        self.assertIn("useEffect(() => setText(''), [draft?.anchor])", section("function CommentPopover(", "function DockView("))
        self.assertIn("useEffect(() => { if (docked) setText('') }, [docked && draft?.anchor])", section("function CommentsPanel(", "function Viewer("))
        self.assertNotIn("'@Hermes '", SRC)
        bridge = (PLUGIN / "hermes_artifacts" / "assets" / "bridge.js").read_text("utf-8")
        self.assertIn('emit("picked-rect", { rect: b ? boxRect(picked.el, b) : pickRect(picked.el) });', bridge)
        self.assertIn('window.addEventListener("scroll", pickedMoved, true);', bridge)
        self.assertIn('window.addEventListener("resize", pickedMoved);', bridge)

    def test_the_pin_never_covers_its_element_when_there_is_room(self):
        # 0.20 click-through: the pin sat on the last letters of "Site survey" and the line above. Now it goes
        # beside the element's box, centred on its first line; over the element only when no side has room.
        body = """
        const out = [], cut = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        for (const [bw, bh] of [[1150, 860], [1568, 860], [760, 640], [400, 520]]) {
          const rects = [{ x: 160, y: 355, w: 775, h: 165, ly: 355, lh: 27 }, { x: 20, y: 40, w: 300, h: 24 }, { x: bw - 140, y: 300, w: 120, h: 40 },
            { x: 0, y: 200, w: bw - 40, h: 30 }, { x: 40, y: 200, w: bw - 40, h: 30 }, { x: 10, y: 0, w: 200, h: 18 }, { x: 10, y: bh - 18, w: 200, h: 18 },
            { x: 0, y: 0, w: bw, h: bh }, { x: 100, y: 100, w: 200, h: 60, fr: false }, { x: 100, y: 100, w: 200, h: 60, fr: false, fl: false }]
          for (const rect of rects) {
            const pin = m.pinSpot(rect, bw, bh), p = { x: pin.x, y: pin.y, w: m.PIN, h: m.PIN }
            const fitsR = rect.fr !== false && rect.x + rect.w + m.PIN_GAP + m.PIN <= bw - 4
            const fitsL = rect.fl !== false && rect.x - m.PIN_GAP - m.PIN >= 4
            const inside = pin.x >= 0 && pin.x + m.PIN <= bw && pin.y >= 0 && pin.y + m.PIN <= bh
            out.push({ bw, rect, pin, room: fitsR || fitsL, covers: cut(p, rect), inside, side: pin.x >= rect.x + rect.w ? 'r' : pin.x + m.PIN <= rect.x ? 'l' : 'over' })
          }
        }
        console.log(JSON.stringify(out))
        """
        out = run_node(stub_module(EXPORTS), body)
        for o in out:
            self.assertTrue(o["inside"], o)
            if o["room"]:
                self.assertFalse(o["covers"], o)  # pin rect ∩ picked rect = ∅
            else:
                self.assertEqual(o["side"], "over", o)  # the corner, inside the element
        first = out[0]  # the reported list item: right of its box, centred on its first line (355 + 27 / 2)
        self.assertEqual(first["side"], "r")
        self.assertEqual(first["pin"]["y"] + 13, 355 + 13.5)
        self.assertIn({"side": "l"}, [{"side": o["side"]} for o in out if o["rect"].get("fr") is False and "fl" not in o["rect"]])
        self.assertTrue(all(o["side"] == "over" for o in out if o["rect"].get("fl") is False))
        # a narrow table cell with words on both sides (the harness's "Ben"): right after its own words, else
        # above or below its right end; the corner only when nothing is free
        body = """
        const cell = { x: 640, y: 453, w: 63, h: 42, ly: 462, lh: 24, lr: 672, fr: false, fl: false }
        console.log(JSON.stringify([m.pinSpot({ ...cell, fw: true }, 1500, 900), m.pinSpot({ ...cell, fw: false, fa: true }, 1500, 900),
          m.pinSpot({ ...cell, fw: false, fa: false, fb: true }, 1500, 900), m.pinSpot({ ...cell, fw: false }, 1500, 900)]))
        """
        words, above, below, corner = run_node(stub_module(EXPORTS), body)
        self.assertEqual(words, {"x": 672 + 6, "y": 462 + 12 - 13, "s": 26})
        self.assertEqual(above, {"x": 703 - 26, "y": 453 - 6 - 26, "s": 26})
        self.assertEqual(below, {"x": 703 - 26, "y": 453 + 42 + 6, "s": 26})
        self.assertEqual(corner, {"x": 703 - 26 - 4, "y": 453 + 4, "s": 26})

    def test_a_pages_own_comment_with_its_rect_opens_beside_it_and_a_point_is_pinned_on(self):
        # V5: a film's point and a design's element (the page's own comment, hermes.comment(anchor, where)) went
        # to the list with no pin; with a rect they open beside it, as a pick does; a point's pin is on the point
        body = """
        m.$panel.set(false)
        m.onPageEvent('comment', { selector: '@t=1.00 @xy=30%,70%', text: 'at 1.00 s', label: 'The harbor · 0:01', rect: { x: 300, y: 400, w: 0, h: 0, pt: true, vis: true } })
        const d = m.$draft.get(), panel = m.$panel.get(), pin = m.pinSpot(d.rect, 1200, 800)
        m.$draft.set(null)
        m.onPageEvent('comment', { selector: '#blk-1', text: 'quoted', label: 'text' })
        const listed = { panel: m.$panel.get(), rect: m.$draft.get().rect || null }
        m.$draft.set(null)
        console.log(JSON.stringify({ rect: d.rect, panel, pin, listed }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out["rect"], {"x": 300, "y": 400, "w": 0, "h": 0, "pt": True, "vis": True})
        self.assertFalse(out["panel"])  # beside it, not in the list
        self.assertEqual(out["pin"], {"x": 300 - 13, "y": 400 - 13, "s": 26})  # centred on the point
        self.assertEqual(out["listed"], {"panel": True, "rect": None})  # no rect (a doc's selected words): the list

    def test_a_comment_is_titled_with_a_name_never_a_tag(self):
        # V5: drafts titled "div" or "canvas", and a filter row's every word ("REGION All North South East West Reset")
        body = """
        const T = a => m.anchorTitle(a, 'Selected part')
        console.log(JSON.stringify([T({ label: 'div', text: '' }), T({ label: 'canvas', text: '' }), T({ label: 'Region filter', text: 'REGION All North South East West Reset' }),
          T({ label: 'text', text: 'This document describes the steps from the request for a quote to the contract' }), T({ label: '', text: '' }),
          T({ label: 'Sticky note', text: '' }), T(null)]))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out, ["Selected part", "Selected part", "Region filter", "This document describes the steps from…",
                               "Selected part", "Sticky note", ""])

    def test_the_bridge_reports_the_first_line_and_the_free_sides(self):
        body = """
        console.log(JSON.stringify([m.pickedRect({ x: 1, y: 2, w: 3, h: 4, ly: 2, lh: 20, lr: 3, fr: false, fl: true, fw: true, fa: false, fb: true, z: 1,
            vt: 44, vb: 700, vis: false }),
          m.pickedRect({ x: 1, y: 2, w: 3, h: 4, ly: 'a', fr: 1, vt: 'a', vis: 0 }), m.pickedRect({ x: 1, y: NaN, w: 3, h: 4 })]))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out, [{"x": 1, "y": 2, "w": 3, "h": 4, "ly": 2, "lh": 20, "lr": 3, "vt": 44, "vb": 700, "fr": False, "fl": True, "fw": True,
                                "fa": False, "fb": True, "vis": False},
                               {"x": 1, "y": 2, "w": 3, "h": 4}, None])
        bridge = (PLUGIN / "hermes_artifacts" / "assets" / "bridge.js").read_text("utf-8")
        self.assertIn("var PIN = 26, PIN_GAP = 6, PIN_EDGE = 4, PIN_MIN = 16;", bridge)  # the host's own numbers
        self.assertIn("const PIN_MIN = 16", SRC)
        self.assertIn("const PIN = 26", SRC)
        self.assertIn("const PIN_GAP = 6", SRC)
        self.assertIn("const PIN_EDGE = 4", SRC)
        self.assertIn('rect: pickRect(el) });', bridge)
        self.assertNotIn("function inked(", bridge)

    def test_the_pin_is_drawn_over_the_box(self):
        pop = section("function CommentPopover(", "function DockView(")
        self.assertIn("zIndex: 28, width: pin.s", pop)
        self.assertIn("zIndex: 27, width: COMMENT_W", pop)

    def test_with_the_list_floating_over_a_narrow_view_nothing_goes_under_it(self):
        # Under 700 px (PANEL_W + STAGE_MIN) the comments list, open, is the whole stage (z 30, over the pin's 28
        # and the box's 27): no pin, and the new comment's box goes into the list.
        body = """
        const out = []
        for (const bw of [360, 400, 440, 520, 600, 675, 676, 699]) {
          const cover = m.panelMode(bw, false).cover, free = bw - cover
          for (const bh of [520, 760]) {
            const rects = [{ x: 10, y: 40, w: 120, h: 24 }, { x: bw / 2, y: bh / 2, w: 80, h: 20 }, { x: bw - 120, y: 100, w: 100, h: 30 },
              { x: 0, y: bh - 30, w: bw, h: 30 }, { x: free - 40, y: 10, w: 30, h: 20 }]
            for (const rect of rects) for (const h0 of [120, 170, 260]) {
              const { pin, box } = m.commentLayout(rect, bw, bh, h0, cover)
              const h = box && box.maxH ? Math.min(h0, box.maxH) : h0 // cut to the room left: it scrolls
              const docks = m.commentDocks(bw, cover)
              const pinOk = !pin || (pin.x >= 0 && pin.x + m.PIN <= free && pin.y >= 0 && pin.y + m.PIN <= bh)
              const boxOk = docks ? box === null : box && box.x >= 0 && box.x + m.COMMENT_W <= free && box.y >= 0 && box.y + h <= bh &&
                (!pin || box.x >= pin.x + m.PIN || box.x + m.COMMENT_W <= pin.x || box.y >= pin.y + m.PIN || box.y + h <= pin.y)
              const pinShown = free >= m.PIN + 8 ? pin !== null : pin === null
              if (!pinOk || !boxOk || !pinShown) out.push({ bw, bh, rect, h, pin, box, docks })
            }
          }
        }
        const docked = [360, 520, 675, 676, 699, 700].map(bw => m.commentDocks(bw, m.panelMode(bw, false).cover))
        console.log(JSON.stringify({ out, docked }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out["out"], [])
        self.assertEqual(out["docked"], [True, True, True, True, True, False])  # the whole stage: the box is in the list
        panel = section("function CommentsPanel(", "function Viewer(")
        self.assertIn("draft && (!draft.rect || docked)", panel)  # the docked box is written in the list
        self.assertIn("$panelCover.set(mode.cover)", panel)
        self.assertIn("$panelCover.set(0)", panel)  # closed or gone: nothing covered
        self.assertIn("top: 0, right: 0, bottom: 0, left: 0, zIndex: 30, background: C.bg", section("function panelStyle(", "/** Whether the new comment's box"))  # opaque, all of it
        self.assertIn("commentLayout(draft.rect, bw, bh, boxH, cover)", section("function CommentPopover(", "function DockView("))
        # in the pane beside a chat too (it had no box at all: the stage there has no id)
        self.assertIn("jsx(CommentPopover, { ctx, art, stageRef: stage })", section("function Viewer(", "function Toast("))

    def test_an_element_scrolled_out_of_the_frame_has_no_pin(self):
        body = """
        const L = r => m.commentLayout(r, 1000, 700, 170, 0)
        console.log(JSON.stringify([L({ x: 100, y: -80, w: 200, h: 40 }).pin, L({ x: 100, y: 720, w: 200, h: 40 }).pin,
          L({ x: -300, y: 100, w: 200, h: 40 }).pin, L({ x: 100, y: -20, w: 200, h: 40 }).pin !== null, L({ x: 100, y: 720, w: 200, h: 40 }).box !== null]))
        """
        self.assertEqual(run_node(stub_module(EXPORTS), body), [None, None, None, True, True])  # partly in view: still pinned

    def test_a_draft_whose_element_is_out_of_sight_waits_in_the_bottom_right_corner(self):
        # Round V1: scrolled out of view, the box jumped to x 310-630 over a doc's contents down its left. Now it
        # waits in the bottom-right corner of the band between the page's bars, whatever the stage and the list.
        body = '''
        const out = []
        for (const [bw, bh, cover] of [[1500, 860, 0], [1000, 700, 0], [700, 520, 0], [1000, 700, 0]])
          for (const rect of [{ x: 310, y: -400, w: 500, h: 40 }, { x: 310, y: 2000, w: 500, h: 40 }, { x: 310, y: 6, w: 500, h: 30, vt: 44, vb: bh - 40, vis: false }])
            for (const h0 of [120, 170, 400]) {
              const { pin, box } = m.commentLayout(rect, bw, bh, h0, cover)
              const vt = rect.vt || 0, vb = rect.vb || bh, h = Math.min(h0, box.maxH)
              out.push([pin, box.x + m.COMMENT_W === bw - cover - 8, box.y + h === vb - 8, box.y >= vt + 8])
            }
        console.log(JSON.stringify(out))
        '''
        for pin, right, bottom, under_bar in run_node(stub_module(EXPORTS), body):
            self.assertEqual((pin, right, bottom, under_bar), (None, True, True, True))

    def test_the_page_bars_are_kept_clear_and_an_element_under_them_has_no_pin(self):
        # Round 1, docked at 1500: a doc's list item scrolled up under the doc's own sticky toolbar kept its pin,
        # clamped onto the toolbar's Editing button. The bridge says what band its bars leave (vt, vb) and whether
        # any of the element is seen (vis): no pin unless it is, and pin and box keep inside that band.
        body = """
        const L = r => m.commentLayout(r, 1000, 700, 170, 0)
        const under = L({ x: 100, y: 6, w: 200, h: 34, vt: 44, vb: 700, vis: false })
        const below = L({ x: 100, y: 6, w: 200, h: 34, vt: 44, vb: 700 })   // wholly above the band's top
        const part = L({ x: 100, y: 30, w: 200, h: 40, ly: 30, lh: 20, vt: 44, vb: 700, vis: true })
        const foot = L({ x: 100, y: 560, w: 600, h: 60, vt: 44, vb: 650, vis: true })
        const thin = L({ x: 100, y: 300, w: 200, h: 20, vt: 290, vb: 360, vis: true }) // too thin a band: the stage
        const back = L({ x: 100, y: 300, w: 200, h: 34, vt: 44, vb: 700, vis: true })
        console.log(JSON.stringify({ under, below, part, foot, thin, back }))
        """
        o = run_node(stub_module(EXPORTS), body)
        self.assertIsNone(o["under"]["pin"])
        self.assertGreaterEqual(o["under"]["box"]["y"], 44 + 8)  # the form stays, off the toolbar
        self.assertIsNone(o["below"]["pin"])
        self.assertGreaterEqual(o["part"]["pin"]["y"], 44 + 4)  # partly seen: pinned, inside the band
        self.assertGreaterEqual(o["part"]["box"]["y"], 44 + 8)
        self.assertLessEqual(o["foot"]["box"]["y"] + min(170, o["foot"]["box"]["maxH"]), 650 - 8)  # off a bottom bar too
        self.assertLessEqual(o["foot"]["box"]["y"] + 170, 560)  # over its element, which leaves room there
        self.assertIsNotNone(o["thin"]["pin"])
        self.assertIsNotNone(o["back"]["pin"])  # scrolled back into view: the pin is back
        self.assertEqual(o["back"]["box"]["y"], 300 + 34 + 8)  # under its element

    def test_the_box_never_covers_its_element_when_there_is_room(self):
        # Round 1: the box sat on the picked element (a checklist item, a KPI tile, a sheet cell) or right beside
        # its pin over the next cells. Now under the element, else over it, else beside it, inside the stage; over
        # the element only when it leaves no room (it fills the stage), then at the bottom edge.
        body = """
        const out = [], cut = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        const M = m.BOX_M, G = m.BOX_GAP, W = m.COMMENT_W
        for (const [bw, bh] of [[1568, 860], [1150, 860], [760, 640], [700, 520], [420, 700]]) {
          const rects = [{ x: 640, y: 453, w: 63, h: 42, ly: 462, lh: 24, lr: 672, fr: false, fl: false, fw: true }, { x: 160, y: 355, w: Math.min(775, bw - 170), h: 165 },
            { x: 207, y: 207, w: 170, h: 105 }, { x: 100, y: bh - 60, w: bw - 200, h: 24 }, { x: 20, y: 10, w: bw - 40, h: 30 },
            { x: bw - 120, y: bh / 2 - 20, w: 100, h: 40 }, { x: 10, y: bh / 2 - 20, w: 90, h: 40, fl: false }, { x: 0, y: 0, w: bw, h: bh },
            { x: 20, y: 20, w: bw - 40, h: bh - 60 }, { x: -30, y: -10, w: 80, h: 40 }, { x: 20, y: 300, w: 240, h: 24, fr: false, fb: true }]
          for (const rect of rects) for (const h0 of [120, 170, 260]) {
            const { pin, box } = m.placeCommentBox(rect, bw, bh, h0)
            const h = Math.min(h0, box.maxH), b = { x: box.x, y: box.y, w: W, h }
            const p = { x: pin.x, y: pin.y, w: m.PIN, h: m.PIN }
            const right = Math.max(rect.x + rect.w, pin.x >= rect.x + rect.w ? pin.x + m.PIN : 0), left = Math.min(rect.x, pin.x + m.PIN <= rect.x ? pin.x : Infinity)
            const room = bh - M - (Math.max(rect.y + rect.h, pin.y >= rect.y + rect.h ? pin.y + m.PIN : 0) + G) >= m.BOX_MIN_H ||
              Math.min(rect.y, pin.y + m.PIN <= rect.y ? pin.y : Infinity) - G - M >= m.BOX_MIN_H ||
              (h0 <= bh - 2 * M && (bw - M - right - G >= W || left - G - M >= W))
            out.push({ bw, bh, rect, h0, box, pin, room, overEl: cut(b, rect), overPin: cut(b, p),
              inside: b.x >= 0 && b.x + W <= bw && b.y >= 0 && b.y + h <= bh })
          }
        }
        console.log(JSON.stringify(out))
        """
        out = run_node(stub_module(EXPORTS), body)
        for o in out:
            self.assertTrue(o["inside"], o)
            self.assertFalse(o["overPin"], o)
            if o["room"]:
                self.assertFalse(o["overEl"], o)  # box ∩ picked rect = ∅
            else:
                self.assertEqual(o["box"]["y"] + min(o["h0"], o["box"]["maxH"]), o["bh"] - 8, o)  # at the bottom edge
        self.assertTrue(any(not o["room"] for o in out))  # the element filling the stage is among them
        cell = [o for o in out if o["bw"] == 1568 and o["rect"]["w"] == 63 and o["h0"] == 170][0]
        self.assertEqual(cell["box"]["y"], 453 + 42 + 8)  # the reported sheet cell: under it, from its left
        self.assertEqual(cell["box"]["x"], 640)

    def test_the_page_stops_following_when_the_comment_closes(self):
        viewer = section("function Viewer(", "function Toast(")
        self.assertIn("if (!following) postToPage(portRef, 'pick-follow', { on: false })", viewer)
        body = """
        const anchor = { selector: '#a', text: 'x', label: 'p' }
        m.$draft.set({ anchor, rect: { x: 1, y: 2, w: 3, h: 4 } })
        const before = m.$draft.get()
        m.onPageEvent('picked-rect', { rect: { x: 1, y: 2, w: 3, h: 4 } })
        console.log(JSON.stringify({ same: m.$draft.get() === before }))
        """
        self.assertEqual(run_node(stub_module(EXPORTS), body), {"same": True})  # an unchanged rect re-renders nothing
        bridge = (PLUGIN / "hermes_artifacts" / "assets" / "bridge.js").read_text("utf-8")
        self.assertIn('on("pick-follow", function (d) { if (!(d && d.on)) unfollow(); });', bridge)
        self.assertIn("var PICKED_GAP_MS = 40;", bridge)
        self.assertNotIn('"contextmenu", "touchstart"', bridge)  # a tap's touchstart is never cancelled


@unittest.skipIf(NODE is None, "node not installed")
class CommentsPanelLayoutTests(unittest.TestCase):
    """0.20 live: at a ~986 px window the comments list covered the sheet's right (its note, "Ask Herm…") while
    the page kept laying out for the whole row. Docked, the list takes its width from the stage: the frame
    ends where the list begins and the page inside lays out for what is seen. Acceptance round 2: in a row under
    700 px (the pane beside a chat, a 400 px window) the floating list covered 40-70 % of the page and opened by
    itself. There it never opens by itself, and open it is the whole stage, opaque, with Back to the artifact;
    it steps aside while an element is picked. Nothing of the page is ever half covered."""

    def styles(self):
        body = """
        const ws = []
        for (let w = 400; w <= 1600; w += 10) ws.push(w)
        console.log(JSON.stringify({ row: m.VIEW_ROW, fill: m.VIEW_FILL, frame: m.FRAME_FIT, min: m.PANEL_W + m.STAGE_MIN,
          at: ws.map(w => ({ w, mode: m.panelMode(w, false), style: m.panelStyle(m.panelMode(w, false)),
            picking: m.panelMode(w, true), pickStyle: m.panelStyle(m.panelMode(w, true)),
            notHere: m.panelMode(w, false, false), notHereStyle: m.panelStyle(m.panelMode(w, false, false)) })) }))
        """
        return run_node(stub_module(EXPORTS), body)

    def test_the_mode_by_width(self):
        s = self.styles()
        self.assertEqual(s["min"], 700)
        for a in s["at"]:
            full = a["w"] < 700
            # opened here: the whole stage (cover: all of it) or docked beside it (cover: none), never a part
            self.assertEqual(a["mode"], {"full": full, "off": False, "hidden": False, "cover": a["w"] if full else 0}, a["w"])
            # picking: the whole-stage list steps aside and covers nothing; a docked one stays as it is
            self.assertEqual(a["picking"], {"full": full, "off": False, "hidden": full, "cover": 0})
            self.assertEqual(a["pickStyle"]["display"], "none" if full else "flex")
            # remembered open, not opened in this view: only where it docks
            self.assertEqual(a["notHere"], {"full": full, "off": full, "hidden": full, "cover": 0})
            self.assertEqual(a["notHereStyle"]["display"], "none" if full else "flex")
            self.assertIn(a["mode"]["cover"], (0, a["w"]))
        panel = section("function CommentsPanel(", "function Viewer(")
        self.assertIn("mode.full ? jsx(IconButton, { icon: 'back', title: t('backToArtifact')", panel)
        self.assertIn("useEffect(() => { $panelHere.set(false) }, [art?.id, docked])", section("function Viewer(", "function Toast("))

    @unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
    def test_a_docked_list_never_covers_the_frame(self):
        s = self.styles()
        script = """
        const S = %s
        const UNITLESS = new Set(['flex', 'flexShrink', 'flexGrow', 'zIndex', 'opacity'])
        const put = (el, o) => { for (const [k, v] of Object.entries(o)) el.style[k] = typeof v === 'number' && !UNITLESS.has(k) ? v + 'px' : v; return el }
        await api.size(1700, 800)
        return await api.top(`(async () => {
          const S = ${JSON.stringify(S)}, UNITLESS = new Set(${JSON.stringify([...UNITLESS])})
          const put = ${put.toString()}
          document.body.style.margin = '0'
          const outer = put(document.createElement('div'), { display: 'flex', flexDirection: 'column', height: '600px' })
          const row = put(document.createElement('div'), S.row), stage = put(document.createElement('div'), S.fill)
          const wrap = put(document.createElement('div'), S.fill), frame = put(document.createElement('iframe'), S.frame)
          frame.srcdoc = '<body style="margin:0"><div style="min-width:700px;height:20px"></div></body>'
          const aside = document.createElement('aside')
          wrap.append(frame); stage.append(wrap); row.append(stage, aside); outer.append(row); document.body.append(outer)
          await new Promise(r => frame.onload = r)
          const out = []
          for (const a of S.at) for (const [mode, style] of [[a.mode, a.style], [a.picking, a.pickStyle], [a.notHere, a.notHereStyle]]) {
            outer.style.width = a.w + 'px'
            aside.removeAttribute('style'); put(aside, style)
            const f = frame.getBoundingClientRect(), p = aside.getBoundingClientRect(), r = row.getBoundingClientRect()
            out.push({ w: a.w, floats: mode.full, hidden: mode.hidden, cover: mode.cover, row: r.width, fl: f.left, fr: f.right, pl: p.left, pr: p.right, pw: p.width,
              inner: frame.contentDocument.documentElement.clientWidth })
          }
          return out
        })()`)
        """ % json.dumps(s)
        r = B.drive(script)
        self.assertIsNone(r.get("err"), r.get("err"))
        out = r["out"]
        self.assertEqual(len(out), 3 * len(s["at"]))
        for o in out:
            self.assertEqual(o["row"], o["w"], o)  # nothing pushes the row past its width
            if not o["floats"]:
                # docked (700-1600): the frame ends where the list begins, both inside the row, the page laid
                # out for exactly what is seen
                self.assertLessEqual(o["fr"], o["pl"], o)
                self.assertLessEqual(o["pr"], o["w"], o)
                self.assertEqual(o["fr"] - o["fl"], o["w"] - o["pw"], o)
                self.assertEqual(o["inner"], o["fr"] - o["fl"], o)
            elif o["hidden"]:
                self.assertEqual(o["pw"], 0, o)  # picking: nothing over the page
                self.assertEqual(o["fr"] - o["fl"], o["w"], o)
            else:
                # the whole stage: all of the frame under it, none of it beside it (never half covered)
                self.assertEqual(o["fr"] - o["fl"], o["w"], o)
                self.assertEqual((o["pl"], o["pw"]), (o["fl"], o["w"]), o)
                self.assertEqual(o["cover"], o["w"], o)


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

    def test_offline_only_when_no_answer_came(self):
        # A server's own sentence about a timeout is its sentence; "offline" is a request that got no answer.
        body = """
        const abort = Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' })
        const cases = [new Error('500: {"detail":"query timed out after 30 s"}'), new Error('query timed out after 30 s'),
          new Error('504: {"detail":"timeout"}'), new Error('502: Failed to fetch'), new TypeError('Failed to fetch'), abort,
          new Error('net::ERR_CONNECTION_REFUSED'), new Error('timeout'), new Error('not connected to the gateway'),
          new Error('NetworkError when attempting to fetch resource.'), new Error('the network error log is full: rotate it')]
        console.log(JSON.stringify(cases.map(c => m.errText(c))))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out, ["query timed out after 30 s", "query timed out after 30 s", "errGeneric", "Failed to fetch", "errOffline",
                               "errOffline", "errOffline", "errOffline", "errOffline", "errOffline",
                               "the network error log is full: rotate it"])

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

    def test_a_card_document_is_marked_for_the_bridge(self):
        body = """
        const html = m.withTheme('<!doctype html><html><head><script>bridge</script></head><body></body></html>', { mode: 'dark', vars: {} })
        console.log(JSON.stringify(html))
        """
        out = run_node(stub_module(EXPORTS + "\nexport { withTheme }\n"), body)
        head = out.split("<head>", 1)[1]
        # The meta comes before the bridge (which reads it at start), on the line of <head> (no line moves).
        self.assertTrue(head.startswith('<meta name="hermes-thumb" content="1"><meta name="hermes-theme"'), head[:80])
        self.assertLess(head.index("hermes-thumb"), head.index("<script>bridge"))
        self.assertEqual(out.count("\n"), 0)

    def test_the_default_design_system_item_is_an_action_both_ways(self):
        out = run_node(stub_module(EXPORTS), "console.log(JSON.stringify([STRINGS.en.dsMake, STRINGS.en.dsUnset, STRINGS.hu.dsMake, STRINGS.hu.dsUnset]))".replace("STRINGS", "m.STRINGS"))
        self.assertEqual(out, ["Make default design system", "Remove as default",
                               "Legyen az alapértelmezett design system", "Ne legyen az alapértelmezett"])
        self.assertEqual(SRC.count("t('dsUnset') : t('dsMake')"), 2)  # the card menu and the title menu

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

    def test_the_html_cache_follows_the_meta_and_forgets_a_deleted_id(self):
        # The document carries the title and the stored preview: a rename or a new picture is a new entry; a
        # rename and a delete drop the id's entries (a reused id is another artifact).
        body = """
        globalThis.window = { location: { hash: '#/', replace() {} }, addEventListener() {}, removeEventListener() {} }
        const asked = []
        const ctx = { rest: async p => { asked.push(p); return { html: '<p>' + p + '</p>' } } }
        const a = { id: 'a', version: 1, updated: 10, title: 'Plan' }
        await m.fetchHtml(ctx, 'a', 1, { stamp: m.htmlStamp(a) }); await m.fetchHtml(ctx, 'a', 1, { stamp: m.htmlStamp(a) })
        const once = asked.length
        await m.fetchHtml(ctx, 'a', 1, { stamp: m.htmlStamp({ ...a, title: 'Plan B' }) })
        await m.fetchHtml(ctx, 'a', 1, { stamp: m.htmlStamp({ ...a, preview: true }) })
        const meta = asked.length
        await m.fetchHtml(ctx, 'ab', 1, { stamp: m.htmlStamp(a) })
        m.dropHtml('a')
        const left = [...m.htmlCache.keys()].map(k => k.split(':')[0])
        await m.fetchHtml(ctx, 'a', 1, { stamp: m.htmlStamp(a) })
        console.log(JSON.stringify({ once, meta, left, again: asked.length }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out, {"once": 1, "meta": 3, "left": ["ab"], "again": 5})
        self.assertIn("dropHtml(art.id) // its document carries the title", section("async function patchMeta(", "/** Text to the system clipboard"))
        self.assertEqual(SRC.count("dropHtml(art.id) // the id may come back as another artifact"), 2)  # the card's and the title's Delete
        self.assertIn("fetchHtml(ctx, art.id, fv, { page, stamp: htmlStamp(art) })", section("function Viewer(", "function Toast("))
        self.assertIn("fetchHtml(ctx, art.id, art.version, { thumb: true, stamp: htmlStamp(art) })", SRC)

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
        self.assertIn("const ListRow = memo(function ListRow({ ctx, art, sort, cols = 'wide' })", SRC)
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

    def test_a_click_does_not_hold_the_hover_buttons(self):
        # A card's and a row's buttons show on hover and for the keyboard's focus; a click focuses a button
        # without :focus-visible, and that alone keeps nothing shown once the pointer leaves.
        hook = section("function useFocusWithin(", "// React.memo")
        self.assertIn("el.matches(':focus-visible')", hook)
        self.assertIn("onFocus: e => setF(keyboard(e.target))", hook)
        for name in ("const Card = memo(", "const ListRow = memo("):
            self.assertIn("useFocusWithin()", section(name, "\n})"), name)

    def test_quiet_text_meets_four_and_a_half(self):
        self.assertIn("text3: 'var(--conversation-scaffold-text, var(--ui-text-secondary))'", SRC)
        self.assertIn("color: hover ? C.fg : C.text2", section("function RowButton(", "function FloatingFooter("))
        self.assertIn("textAlign: 'center', fontSize: 13, color: C.text2 },", section("const noMatch = ", "const body = err"))
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
        # each value ticked counts: Doc + Sheet is 2, not one "Type"
        self.assertEqual(run_node(stub_module(EXPORTS), "console.log(JSON.stringify(m.filterCount(['doc', 'sheet'], 'any', false)))"), 2)
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


@unittest.skipIf(NODE is None, "node not installed")
class ClickThroughTests(unittest.TestCase):
    """The 0.20 click-through in Hermes Desktop: tooltips behind menus, filter names and counts, the list's
    comment badge, a still header, the comment forms, empty states, one date shape, the edit band, Move to,
    copy titles and the card menu's keys."""

    def test_no_tile_tooltip_while_a_menu_or_dialog_is_open(self):
        self.assertIn("(h || f) && !popups ? jsx(TileTip,", section("function NewTile(", "/** A small round button"))
        for name, end in (("function PopMenu(", "function MenuRow("), ("function RenameDialog(", "const Card = memo("),
                          ("function ConfirmSend(", "function AllowDialog(")):
            self.assertIn("usePopupOpen(", section(name, end), name)
        self.assertEqual(SRC.count("role: 'tooltip'"), 1)  # TileTip is the half's only drawn tooltip
        self.assertEqual(run_node(stub_module(EXPORTS), "console.log(JSON.stringify(m.$popups.get()))"), 0)
        hook = section("function usePopupOpen(", "/** A New tile's tooltip")
        self.assertIn("return () => $popups.set(Math.max(0, $popups.get() - 1))", hook)  # closed: counted off

    def test_the_type_filter_names_types_as_the_cards_do(self):
        menu = section("function FilterMenu(", "function NewMenu(")
        self.assertIn("'dashboard', 'motion', 'page']", SRC)  # a page is "Page" in the filter, as on its card
        self.assertIn("count('other') || types.includes('other') ? ['other'] : []", menu)
        self.assertIn("label: k === 'other' ? t('other') : t(`type_${k}`)", menu)

    def test_a_list_row_shows_open_comments_like_a_card(self):
        self.assertIn("art.comments ? jsx(CommentCount, { n: art.comments }) : null", section("const Card = memo(", "const ListRow = memo("))
        self.assertIn("art.comments ? jsx(CommentCount, { n: art.comments }) : null", section("const ListRow = memo(", "function TrashRow("))

    def test_the_header_gives_the_comment_count_its_room_only_when_there_is_one(self):
        # V6f: with no comments the button kept the room (48 px, its icon at the left): now its icon's alone
        header = section("function Header(", "const PIN = 26")
        self.assertIn("count: open,", header)
        self.assertNotIn("label: open ? String(open) : null", header)
        btn = section("function IconButton(", "function Chip(")
        self.assertIn("minWidth: '2ch'", btn)
        self.assertIn("count ? jsx('span', { style: { minWidth: '2ch'", btn)

    def test_comment_forms_grow_without_a_grip_and_discard_by_one_name(self):
        form = section("function CommentForm(", "function CommentsPanel(")
        self.assertIn("resize: 'none'", form)
        self.assertNotIn("resize: 'vertical'", form)
        self.assertIn("el.style.height = `${Math.min(full, TEXT_MAX_H)}px`", form)
        # the new comment's box and a reply: one form, the same text buttons (round 1: icons in the box)
        self.assertEqual(form.count("children: t('discard') })"), 1)
        self.assertEqual(form.count("children: t('save') })"), 1)
        self.assertNotIn("jsx(Icon", form)
        self.assertNotIn("t('cancel')", form)
        self.assertIn("if (e.key === 'Escape') return discard()", form)

    def test_one_empty_state_for_every_type_and_tab(self):
        panel = section("function CommentsPanel(", "function Viewer(")
        self.assertIn("!roots.length ? 'noComments' : filter === 'open' && !open.length ? 'noOpenComments' : filter === 'resolved' && !done.length ? 'noResolvedComments' : null", panel)
        self.assertIn("children: t(empty) })", panel)

    def test_dates_in_the_app_language_one_shape(self):
        body = "console.log(JSON.stringify([m.dateText(Date.UTC(2026, 10, 13, 14, 43) / 1000), m.dateText(Date.UTC(2026, 10, 13, 14, 43) / 1000, true)]))"
        day, when = run_node(stub_module(EXPORTS), body)
        self.assertEqual(day, "Nov 13")
        self.assertRegex(when, r"^Nov 13, \d\d:43 [AP]M$")  # the type pages' history shape (kit.locale(): en)
        self.assertNotIn("toLocaleDateString(undefined", SRC)
        self.assertNotIn("toLocaleString()", SRC)
        self.assertIn("const lang = tr('lang') === 'hu' ? 'hu' : 'en'", section("function dateText(", "// ---------------------------------------------------------------- look"))
        self.assertIn("const date = updated ? dateText(updated, true) : ''", section("function TitleMenu(", "function TitleButton("))

    def test_an_edit_of_an_artifact_there_is_says_editing(self):
        body = """
        m.$list.set([{ id: 'a1', session: 's1', type: 'sheet', title: 'Test sheet' }, { id: 'a2', session: 's2', type: 'doc', title: 'D' }])
        const before = m.editOf('s1', 'sheet')
        m.askedEdit({ id: 'a1' })
        const now = Date.now()
        console.log(JSON.stringify([before, m.editOf('s1', 'sheet'), m.editOf('s1', 'dashboard'), m.editOf('s2', 'doc'), m.editOf('s1', 'sheet', now + 11 * 60 * 1000)]))
        """
        self.assertEqual(run_node(stub_module(EXPORTS), body), [None, "a1", None, None, None])
        line = section("function MakingLine(", "function MakingSkeleton(")
        self.assertIn("edited ? t('editingBand', edited.title) : t('makingBand', name)", line)
        making = section("function onMaking(", "/** The publish's `open`")
        self.assertIn("if (!edit) showMaking(ctx, sid)", making)
        tool = section("function onTool(", "/** After a reload")
        self.assertIn("(name === 'ha_publish' || name === 'ha_live_edit') && typeof args?.id === 'string'", tool)
        # marked where the person asks for a change: a comment sent, the chat over the artifact, a page's ask
        self.assertIn("askedEdit(art)", section("function CommentForm(", "function CommentsPanel("))
        self.assertIn("if (art) askedEdit(art)", section("function FloatingChat(", "function visibleBox("))
        self.assertIn("if (a.kind !== 'convert') askedEdit(art)", SRC)

    def test_move_to_marks_where_it_is(self):
        menu = section("function CardMenu(", "/** The title on a card")
        self.assertIn("checked: !art.folder, disabled: !art.folder", menu)
        self.assertIn("checked: art.folder === f, disabled: art.folder === f", menu)
        self.assertNotIn("inNoFolder", SRC)

    def test_the_server_names_a_copy(self):
        # one place numbers copies (api.copy_title, test_viewer_api); the half sends only its language's word
        self.assertEqual(SRC.count("/duplicate`"), 1)  # the card menu and the title menu: duplicateArt
        self.assertIn("body: { word: tr('copyWord') }", section("async function duplicateArt(", "const CARD_KEYS"))
        self.assertNotIn("copySuffix", SRC)

    def test_every_hinted_card_key_acts_in_the_menu_and_on_a_card(self):
        body = """
        const ev = (key, extra = {}) => ({ key, target: { tagName: 'DIV' }, ...extra })
        console.log(JSON.stringify([m.CARD_KEYS, ['p', 'R', 'd', 'c', 'm', 'x'].map(k => m.cardKey(ev(k))), m.cardKey(ev('p', { ctrlKey: true })),
          m.cardKey(ev('p', { target: { tagName: 'INPUT' } }))]))
        """
        keys, got, ctrl, typing = run_node(stub_module(EXPORTS), body)
        self.assertEqual(keys, {"p": "pin", "r": "rename", "d": "duplicate", "c": "link", "m": "move"})
        self.assertEqual(got, ["pin", "rename", "duplicate", "link", "move", None])
        self.assertIsNone(ctrl)
        self.assertIsNone(typing)
        menu = section("function CardMenu(", "/** The title on a card")
        hints = {"P": "run('pin')", "R": "run('rename')", "D": "run('duplicate')", "C": "run('link')", "M": "setView('move')"}
        for letter, action in hints.items():
            self.assertIn(f"right: '{letter}'", menu)
            self.assertIn(action, menu)
        self.assertEqual(menu.count("right: '"), len(hints))  # a hint only where a key acts
        for name, end in (("const Card = memo(", "const ListRow = memo("), ("const ListRow = memo(", "function TrashRow(")):
            # on the card's outer box: the card itself and its buttons (where a closed menu gives the focus back)
            self.assertIn("onKeyDown: e => cardKeyDown(e, ctx, art, { menu, renaming, setMenu, setRenaming, self })", section(name, end), name)
            self.assertIn("...cardContext(setMenu, setAt)", section(name, end), name)
        kd = section("function cardKeyDown(", "const Card = memo(")
        self.assertIn("if (renaming || menu) return", kd)
        self.assertIn("e.target === self.current ? openOnPage(ctx, art.id) : undefined", kd)  # Enter on a button is its own
        self.assertIn("'data-hermes-context-menu-trigger': ''", kd)  # Hermes' app-wide menu leaves the gesture to the row


@unittest.skipIf(NODE is None, "node not installed")
class ServerContractTests(unittest.TestCase):
    """What the 0.20 server offers and the half uses: the list poll's etag, a typed artifact's html as a cached
    shell plus its content, and the frames' notify op. Each with a server that does not offer it."""

    def test_the_poll_sends_its_etag_and_keeps_the_list_when_unchanged(self):
        body = """
        globalThis.window = { location: { hash: '#/', replace() {} }, addEventListener() {}, removeEventListener() {} }
        const asked = []
        let answer = { artifacts: [{ id: 'a', title: 'A', type: 'doc', version: 1, versions: [1] }], folders: [], etag: 'e1' }
        const ctx = { storage: { get: () => null, set() {} }, register: () => () => {},
          rest: async p => { asked.push(p); if (p.startsWith('/trash')) return { trash: [] }; return answer } }
        await m.refresh(ctx)
        const first = m.$list.get()
        answer = { unchanged: true, etag: 'e1' }
        await m.refresh(ctx)
        const kept = m.$list.get() === first && first.length === 1
        answer = { artifacts: [], folders: [] } // a server before 0.20: no etag
        await m.refresh(ctx)
        const emptied = m.$list.get().length === 0
        await m.refresh(ctx)
        console.log(JSON.stringify({ asked: asked.filter(p => !p.startsWith('/trash')), kept, emptied }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out["asked"], ["/artifacts", "/artifacts?etag=e1", "/artifacts?etag=e1", "/artifacts"])
        self.assertTrue(out["kept"])
        self.assertTrue(out["emptied"])

    def test_a_typed_document_is_its_cached_shell_around_its_content(self):
        body = """
        const asked = []
        let shells = { h1: { hash: 'h1', head: '<head>', tail: '</head><body></body>' } }
        const ctx = { rest: async p => {
          asked.push(p)
          if (p.startsWith('/shells/')) { const s = shells[p.slice(8)]; if (!s) throw new Error('404: unknown shell'); return s }
          if (p.includes('/old/')) return { html: '<whole old>' }
          if (p.endsWith('&split=1')) return { id: 'x', shell: 'h1', content: p.includes('/b/') ? '<b>' : '<a>' }
          return { html: '<whole>' }
        } }
        const a = await m.fetchDocument(ctx, '/artifacts/a/html?v=1')
        const b = await m.fetchDocument(ctx, '/artifacts/b/html?v=1')
        const old = await m.fetchDocument(ctx, '/artifacts/old/html?v=1')
        m.shellCache.clear(); shells = {}
        const gone = await m.fetchDocument(ctx, '/artifacts/a/html?v=2')
        console.log(JSON.stringify({ a, b, old, gone, asked, cached: m.shellCache.size }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out["a"], "<head><a></head><body></body>")
        self.assertEqual(out["b"], "<head><b></head><body></body>")
        self.assertEqual(out["old"], "<whole old>")  # a server without split answers the whole html
        self.assertEqual(out["gone"], "<whole>")  # a shell the server forgot: asked again without split
        self.assertEqual(out["asked"].count("/shells/h1"), 2)  # once while cached, once after it was dropped
        self.assertEqual(out["asked"][-1], "/artifacts/a/html?v=2")
        self.assertEqual(out["cached"], 0)
        self.assertIn("fetchDocument(ctx, `/artifacts/${enc(id)}/html?${q}`)", section("function fetchHtml(", "// A typed artifact's"))

    def test_notify_is_validated_answered_and_shown_only_in_sight(self):
        body = """
        const ok = [{ message: 'Saved', kind: 'success', ms: null }, { message: 'x'.repeat(300), kind: 'error', ms: 15000 }, { message: 'Hi', kind: 'info' }]
        const bad = [null, 'Saved', { message: '', kind: 'info' }, { message: 'x'.repeat(301), kind: 'info' }, { message: 'a', kind: 'warn' },
          { message: 'a', kind: 'info', ms: 0 }, { message: 'a', kind: 'info', ms: 15001 }, { message: 'a', kind: 'info', ms: '9' }, { message: 3, kind: 'info' }]
        console.log(JSON.stringify({ ok: ok.map(m.notifyArgs), bad: bad.map(m.notifyArgs), pass: m.PASS_OPS.has('notify'), grace: m.GRACE_REFUSED.has('notify') }))
        """
        out = run_node(stub_module(EXPORTS), body)
        self.assertEqual(out["ok"][0], {"message": "Saved", "kind": "success", "ms": None})
        self.assertEqual(out["ok"][1]["ms"], 15000)
        self.assertEqual(out["ok"][2], {"message": "Hi", "kind": "info", "ms": None})
        self.assertEqual(out["bad"], [None] * 9)
        self.assertTrue(out["pass"])  # a frame out of sight is answered at once (and shows nothing)
        self.assertTrue(out["grace"])  # a page going away shows nothing
        handler = section("if (m.op === 'notify') {", "if (m.op === 'vendor') {")
        self.assertIn("if (!F.hidden(rec) && noteGate(rec.notes || (rec.notes = { times: [], msg: '' }), note.message, Date.now())) toast(noteText(art.title, note.message), note.kind, note.ms)", handler)
        self.assertIn("return reply({ ok: true, value: { ok: true } })", handler)
        self.assertIn("...(ms ? { durationMs: ms } :", section("function toast(", "function errText("))

    def test_a_frame_cannot_flood_the_toasts_or_pass_for_hermes(self):
        body = """
        const g = { times: [], msg: '' }, at = []
        const steps = [[0, 'A'], [500, 'B'], [1500, 'A'], [1500, 'B'], [3000, 'C'], [4500, 'D'], [6000, 'E'], [7500, 'F'], [9000, 'G'],
          [61000, 'F'], [61200, 'H'], [70000, 'F']]
        for (const [t, msg] of steps) at.push(m.noteGate(g, msg, t))
        console.log(JSON.stringify({ at, short: m.noteText('Facade orders 2026', 'Saved'), long: m.noteText('x'.repeat(60), 'Saved'), none: m.noteText('', 'Saved') }))
        """
        out = run_node(stub_module(EXPORTS), body)
        # under a second apart, the same words again within the minute and a sixth in a minute are not shown
        self.assertEqual(out["at"], [True, False, False, True, True, True, True, False, False, True, False, False])
        self.assertEqual(out["short"], "Facade orders 2026: Saved")
        self.assertEqual(out["long"], "x" * 39 + "…: Saved")
        self.assertEqual(out["none"], "?: Saved")
        handler = section("if (m.op === 'notify') {", "if (m.op === 'vendor') {")
        # a plain page has no kit: answered quietly, nothing shown (a refusal threw in the page on every call)
        self.assertIn("if ((art.type || 'page') === 'page') return reply({ ok: true, value: { ok: false, shown: false } })", handler)



@unittest.skipIf(NODE is None, "node not installed")
class ThemeModeTests(unittest.TestCase):
    """Acceptance round 3: Hermes' light body computes as color(srgb 0.996 0.996 0.996), which the old reader
    took as 0-255 numbers, so every frame got data-theme="dark". Each colour form Chromium computes is read."""

    def test_each_colour_form(self):
        forms = {"rgb(31, 31, 30)": [31, 31, 30, 1], "rgba(250, 249, 245, 0.5)": [250, 249, 245, 0.5],
                 "rgb(250 249 245 / 50%)": [250, 249, 245, 0.5], "#fff": [255, 255, 255, 1], "#1f1f1e80": [31, 31, 30, 128 / 255],
                 "color(srgb 0.996 0.996 0.996)": [254, 254, 254, 1], "color(srgb 0.12 0.12 0.118 / 0.5)": [31, 31, 30, 0.5],
                 "color(srgb-linear 1 1 1)": [255, 255, 255, 1], "color(display-p3 1 1 1)": [255, 255, 255, 1],
                 "color(display-p3 0.1 0.1 0.1)": [26, 26, 26, 1], "oklab(1 0 0)": [255, 255, 255, 1], "oklab(0% 0 0)": [0, 0, 0, 1],
                 "oklch(0.98 0 90)": [248, 248, 248, 1], "oklch(0.2 0.01 250)": [19, 22, 26, 1], "lab(97 0 0)": [247, 247, 247, 1],
                 "lch(12 0 0)": [31, 31, 31, 1], "nonsense": None, "color(rec2020 1 1 1)": None}
        body = "console.log(JSON.stringify({ got: " + json.dumps(list(forms)) + ".map(m.cssRgb), modes: [[31,31,30],[254,254,254],[120,120,120],[140,140,140]].map(m.modeOf), " \
               "txt: ['color(srgb 0.996 0.996 0.996)', 'oklch(0.98 0 90 / 0.5)', 'rgb(1, 2, 3)', 'weird(1)'].map(m.rgbText) }))"
        out = run_node(stub_module("\nexport { cssRgb, modeOf, rgbText }\n"), body)
        for (form, want), got in zip(forms.items(), out["got"]):
            if want is None:
                self.assertIsNone(got, form)
                continue
            self.assertTrue(all(abs(g - w) <= 1 for g, w in zip(got[:3], want[:3])), (form, got))
            self.assertAlmostEqual(got[3], want[3], 2, form)
        self.assertEqual(out["modes"], ["dark", "light", "dark", "light"])
        self.assertEqual(out["txt"], ["rgb(254, 254, 254)", "rgba(248, 248, 248, 0.5)", "rgb(1, 2, 3)", "weird(1)"])
        mode = section("function hostMode()", "function modeOf(")
        self.assertIn("de.dataset?.hermesMode", mode)  # Hermes' own signal (as its previews read it) first
        self.assertIn("rgbText(c)", section("function hostTheme()", "function hostMode()"))  # the vars sent as rgb()

    @unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
    def test_in_chrome_every_form_tells_light_from_dark(self):
        fns = "".join(section(a, b) for a, b in (("const toLin =", "let rgbCanvas"), ("function hostMode()", "const toLin =")))
        fns += section("let rgbCanvas", "/** A colour as rgb(")
        cases = [("color(srgb 0.996 0.996 0.996)", None, "light"), ("color(srgb 0.11 0.11 0.11)", None, "dark"),
                 ("oklch(0.98 0.005 90)", None, "light"), ("oklch(0.21 0.01 260)", None, "dark"), ("lab(98 0 0)", None, "light"),
                 ("color(display-p3 0.99 0.99 0.99)", None, "light"), ("rgb(31, 31, 30)", None, "dark"),
                 ("rgb(31, 31, 30)", "light", "light"), ("rgb(250, 250, 250)", "dark", "dark")]
        script = "return await api.top(" + json.dumps("(() => { " + fns + " const out = []; for (const [bg, attr] of " + json.dumps(
            [[c[0], c[1]] for c in cases]) + ") { document.body.style.background = bg; if (attr) document.documentElement.dataset.hermesMode = attr;"
            " else delete document.documentElement.dataset.hermesMode; out.push([getComputedStyle(document.body).backgroundColor, hostMode()]) }"
            " return out })()") + ")"
        r = B.drive("await api.go('about:blank', 300);\n" + script)
        self.assertIsNone(r.get("err"), r)
        for (bg, attr, want), (computed, got) in zip(cases, r["out"]):
            self.assertEqual(got, want, (bg, attr, computed))


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
