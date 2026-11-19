"""Round V6x: an artifact keeps its view when Hermes mounts its tile anew (the chat beside it collapsed or shown, an
SDK limit): the host keeps what the page last reported (bridge view: its context and its keep) and hands it back to the
page loaded again ("view-restore"); each type puts itself back as it was. The whole viewer (plugin.js's Viewer, its
frames and bridge, the real page) unmounted and mounted again, and each type's page given a view-restore, in headless
Chrome. Skipped without Chrome or node."""

import json
import unittest

import _browser as B
import _dom as D
import test_desktop_viewer as V
import test_type_pages_v6s as v6s
from hermes_artifacts import store

EX = D.ROOT / "examples"
MOUNT = "await api.top(`(() => { const { M, R, jsx, ctx } = window.H; R.mount(() => jsx(M.Viewer, { ctx }), document.getElementById('root')) })()`)"


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class ViewerKeepsTheView(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()
        cls.host.files.update(D.viewer_files(V.EXPORTS))

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def remount(self, aid, sel, before, after, w=1250, settle=1500):
        """The viewer on aid, `before` (its page's view changed), unmounted and mounted again: `after` once SEL is drawn."""
        url = f"http://127.0.0.1:{self.host.port}/dom/index.html"
        r = B.drive(f"const URL = {json.dumps(url)}, AID = {json.dumps(aid)}, SEL = {json.dumps(sel)}, SETTLE = {settle}; await api.size({w}, 800);"
                    + V.BOOT_ANY + before + """
          await api.sleep(1200) // the page's view said (600 ms after its change)
          await api.top('window.H.R.unmount()'); await api.sleep(400)
          """ + MOUNT + """
          for (let i = 0; i < 80; i++) { await api.sleep(150); try { if (await api.frame('!!(' + SEL + ')')) break } catch (_) {} }
          await api.sleep(SETTLE)
          return await api.frame(""" + json.dumps(after) + ")", timeout=240)
        self.assertIsNone(r.get("err"), r)
        return r["out"]

    def test_a_film_keeps_its_time_and_scene(self):
        # V6x 1: at 0:08 of 0:13 (its second scene on), the chat collapsed: back at 0:00, the first scene on
        aid = store.publish(path=str(EX / "motion"), title="Harbor film", type="motion")["id"]
        o = self.remount(aid, 'window.__motion && __motion.timeline.length', "await api.frame('__motion.pause(); __motion.seek(8)')",
                         '({ t: __motion.t, on: [...document.querySelectorAll(".mo-seg")].findIndex(e => e.classList.contains("on")),'
                         ' time: document.querySelector(".mo-time").textContent })')
        self.assertAlmostEqual(o["t"], 8, delta=0.05, msg=o)
        self.assertEqual(o["on"], 1, o)
        self.assertTrue(o["time"].startswith("0:08"), o)


# The page's own part, without the viewer: what it reports (its last view op: context and keep), and the view-restore.
LAST_VIEW = 'window.__ops.filter(o => o.op === "view").map(o => o.args).pop() || null'


def restore(context, keep):
    """The host's view-restore to the page (what it reported before its frame was loaded again), then 1.5 s."""
    d = json.dumps({"v": 1, "context": context, "keep": keep})
    return "await api.top(" + json.dumps(f'window.__post("view-restore", {d})') + "); await api.sleep(1500)\n"


@unittest.skipUnless(B.AVAILABLE, "Chrome or node is not installed")
class TypesPutTheirViewBack(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = B.Host()

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    drive_page = v6s.RoundV6sPages.drive_page

    def test_a_deck_its_slide_and_its_thumbnails_hidden(self):
        # V6x 1: a deck on slide 3 with its thumbnails hidden, its chat collapsed: back on slide 1, the thumbnails shown
        aid = store.publish(path=str(EX / "slides"), title="Test slides", type="slides")["id"]
        o = self.drive_page(aid, """
          await api.frame('document.querySelectorAll(".sl-thumb")[2].click()'); await api.sleep(1200)
          return { before: await api.top(""" + json.dumps(LAST_VIEW) + """) }""", settle=2000)
        b = o["before"]
        self.assertEqual(b["context"]["slideIndex"], 3, o)
        self.assertEqual(b["keep"], {"strip": True, "props": False}, o)
        o = self.drive_page(aid, restore({"slideId": b["context"]["slideId"]}, {"strip": False, "props": False}) + """
          return { on: await api.frame('[...document.querySelectorAll(".sl-thumb")].findIndex(t => t.classList.contains("on"))'),
                   strip: await api.frame('document.getElementById("sl-strip").hidden'), said: await api.top(""" + json.dumps(LAST_VIEW) + """) }""", settle=2000)
        self.assertEqual((o["on"], o["strip"]), (2, True), o)
        self.assertEqual(o["said"]["keep"], {"strip": False, "props": False}, o)

    def scrolled(self, aid, scroll, at, settle=2500):
        """What the page reports scrolled (`scroll`: frame JS), then, loaded anew, `at` (frame JS) after the view-restore."""
        o = self.drive_page(aid, f"await api.frame({json.dumps(scroll)}); await api.sleep(1200)\nreturn await api.top({json.dumps(LAST_VIEW)})", settle=settle)
        self.assertTrue(o and o.get("keep"), o)
        back = self.drive_page(aid, restore(o["context"], o["keep"]) + f"return await api.frame({json.dumps(at)})", settle=settle)
        return o, back

    def test_a_doc_its_scroll(self):
        # V6x 1 (survey): a doc scrolled 300 px down, its chat collapsed: back at its top
        aid = store.publish(title="Long", type="doc", files={"doc.md": "# Long\n\n" + "\n\n".join(f"Paragraph {i} of the long doc, a line of words." for i in range(80))})["id"]
        o, back = self.scrolled(aid, "window.scrollTo(0, 400)", "window.scrollY")
        self.assertEqual(o["keep"], {"y": 400}, o)
        self.assertAlmostEqual(back, 400, delta=1)

    def test_a_dashboard_its_scroll(self):
        # V6x 1 (survey): a dashboard scrolled 300 px down, its chat collapsed: back at its top (its filters were kept)
        from test_type_pages_browser import DASH2, DASH2_CSV
        aid = store.publish(title="Test dash2", type="dashboard", files={"dashboard.json": DASH2, "data/monthly.csv": DASH2_CSV})["id"]
        o, back = self.drive_size(lambda: self.scrolled(aid, "window.scrollTo(0, 300)", "window.scrollY"), 500)
        self.assertEqual(o["keep"], {"y": 300}, o)
        self.assertAlmostEqual(back, 300, delta=1)

    def test_a_sheet_its_selection_scroll_and_zoom(self):
        # V6x 1 (survey): a sheet scrolled down with B31 selected, zoomed to 125 %, its chat collapsed: back at A1, at
        # its top, at 100 % (its zoom lived in localStorage, which throws in the sandboxed frame)
        rows = [["Item", "Cost"]] + [[f"Row {i}", i] for i in range(1, 200)]
        aid = store.publish(title="Costs", type="sheet", files={"sheet.json": {"title": "Costs", "sheets": [{"name": "Costs", "rows": rows}]}})["id"]
        o, back = self.scrolled(aid, 'document.getElementById("sh-grid").scrollTop = 600',
                                '({ name: document.querySelector(".sh-name").value, st: document.getElementById("sh-grid").scrollTop,'
                                ' z: getComputedStyle(document.documentElement).getPropertyValue("--sh-z").trim() })')
        self.assertEqual((o["keep"]["st"], o["keep"]["sr"], o["keep"]["prefs"]["zoom"]), (600, 0, 100), o)
        o["keep"].update(sr=30, sc=1, er=30, ec=1, prefs=dict(o["keep"]["prefs"], zoom=125))
        back = self.drive_page(aid, restore(o["context"], o["keep"]) + 'return await api.frame(\'({ name: document.querySelector(".sh-name").value,'
                               ' st: document.getElementById("sh-grid").scrollTop, z: getComputedStyle(document.documentElement).getPropertyValue("--sh-z").trim() })\')', settle=2500)
        self.assertEqual((back["name"], back["st"], back["z"]), ("B31", 600, "1.25"), back)

    def test_a_board_its_middle_and_zoom(self):
        # V6x 1 (survey): a board panned and zoomed, its chat collapsed: fitted again (its camera lived in localStorage,
        # which throws in the sandboxed frame). The point at its view's middle and the zoom come back, at any width.
        board = {"title": "B", "items": [{"id": "a", "type": "box", "text": "Review"}, {"id": "b", "type": "box", "text": "Ship", "x": 900, "y": 600}]}
        aid = store.publish(title="B", type="board", files={"board.json": board})["id"]
        mid = ('(() => { const v = document.querySelector(".bd-view").getBoundingClientRect(), m = /translate\\(([-\\d.]+)px, ?([-\\d.]+)px\\) scale\\(([\\d.]+)\\)/'
               '.exec(document.querySelector(".bd-world").style.transform).slice(1).map(Number); return { cx: (v.width / 2 - m[0]) / m[2], cy: (v.height / 2 - m[1]) / m[2], z: m[2] } })()')
        o = self.drive_page(aid, f"await api.sleep(1200)\nreturn {{ said: await api.top({json.dumps(LAST_VIEW)}), mid: await api.frame({json.dumps(mid)}) }}", settle=2500)
        k = o["said"]["keep"]
        self.assertAlmostEqual(k["cx"], o["mid"]["cx"], delta=1, msg=o)
        self.assertAlmostEqual(k["z"], o["mid"]["z"], delta=0.001, msg=o)
        for w in (1250, 700):
            back = self.drive_page(aid, restore(o["said"]["context"], {"cx": 820, "cy": 610, "z": 1.5}) + f"return await api.frame({json.dumps(mid)})", w=w, settle=2500)
            self.assertAlmostEqual(back["cx"], 820, delta=1, msg=(w, back))
            self.assertAlmostEqual(back["cy"], 610, delta=1, msg=(w, back))
            self.assertAlmostEqual(back["z"], 1.5, delta=0.001, msg=(w, back))

    def test_a_designs_canvas_its_middle_and_zoom(self):
        # V6x 1 (survey): a design's canvas panned and zoomed, its chat collapsed: fitted again. Its middle and zoom come back.
        aid = store.publish(path=str(EX / "design"), title="Test design", type="design")["id"]
        mid = ('(() => { const v = document.getElementById("dc-view").getBoundingClientRect(), s = __design.state();'
               ' return { cx: (v.width / 2 - s.tx) / s.z, cy: (v.height / 2 - s.ty) / s.z, z: s.z } })()')
        o = self.drive_page(aid, f"await api.sleep(1200)\nreturn {{ said: await api.top({json.dumps(LAST_VIEW)}), mid: await api.frame({json.dumps(mid)}) }}", settle=3000)
        k = o["said"]["keep"]
        self.assertAlmostEqual(k["cx"], o["mid"]["cx"], delta=1, msg=o)
        self.assertAlmostEqual(k["z"], o["mid"]["z"], delta=0.001, msg=o)
        for w in (1250, 700):
            back = self.drive_page(aid, restore(o["said"]["context"], {"page": None, "cx": 700, "cy": 400, "z": 0.5}) + f"return await api.frame({json.dumps(mid)})", w=w, settle=3000)
            self.assertAlmostEqual(back["cx"], 700, delta=1, msg=(w, back))
            self.assertAlmostEqual(back["cy"], 400, delta=1, msg=(w, back))
            self.assertAlmostEqual(back["z"], 0.5, delta=0.001, msg=(w, back))

    def test_a_design_systems_section_and_scroll(self):
        # V6x 1 (survey): a design system on Typography, scrolled, its chat collapsed: back on Overview at its top
        aid = store.publish(path=str(EX / "design-system"), title="Test design system", type="design-system")["id"]
        o = self.drive_page(aid, """
          await api.frame('[...document.querySelectorAll(".ds-nav-i")].find(e => /Typography/.test(e.textContent)).click()'); await api.sleep(500)
          await api.frame('window.scrollTo(0, 200)'); await api.sleep(1200)
          return await api.top(""" + json.dumps(LAST_VIEW) + ")", w=1250, hh=500, settle=2500)
        self.assertEqual((o["context"]["section"], o["keep"]), ("type", {"y": 200, "theme": None}), o)
        back = self.drive_page(aid, restore(o["context"], o["keep"]) + """
          return await api.frame('({ on: document.querySelector(".ds-nav-i.on").textContent.trim(), y: window.scrollY })')""", w=1250, hh=500, settle=2500)
        self.assertEqual(back, {"on": "Typography", "y": 200}, back)

    def test_a_models_camera(self):
        # V6x 1 (survey): a model turned to its top view, its chat collapsed: back at its first view. Its camera comes back.
        from test_models import PANEL
        aid = store.publish(title="Panel", type="model", files={"model.json": PANEL})["id"]
        cam = '(() => { const t = __model.three(); return { pos: t.camera.position.toArray(), target: t.controls.target.toArray(), ortho: !!t.camera.isOrthographicCamera } })()'
        o = self.drive_page(aid, f"await api.frame('__model.setView(\"top\")'); await api.sleep(1600)\nreturn {{ said: await api.top({json.dumps(LAST_VIEW)}), cam: await api.frame({json.dumps(cam)}) }}", settle=3000)
        k = o["said"]["keep"]
        for a, b in zip(k["pos"] + k["target"], o["cam"]["pos"] + o["cam"]["target"]):
            self.assertAlmostEqual(a, b, delta=0.02, msg=o)
        back = self.drive_page(aid, restore(o["said"]["context"], k) + f"return await api.frame({json.dumps(cam)})", settle=3000)
        for a, b in zip(back["pos"] + back["target"], k["pos"] + k["target"]):
            self.assertAlmostEqual(a, b, delta=0.05, msg=(back, k))
        self.assertEqual(back["ortho"], k["ortho"], back)

    def drive_size(self, fn, hh):
        """fn() with the pages hh px tall (one that scrolls)."""
        old = self.drive_page
        self.drive_page = lambda aid, body, w=1250, hh0=716, settle=3000: old(aid, body, w, hh, settle)
        try:
            return fn()
        finally:
            del self.drive_page


if __name__ == "__main__":
    unittest.main()
