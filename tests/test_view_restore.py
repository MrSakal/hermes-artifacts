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


if __name__ == "__main__":
    unittest.main()
