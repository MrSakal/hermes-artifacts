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


if __name__ == "__main__":
    unittest.main()
