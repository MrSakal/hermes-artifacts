"""The REST API through FastAPI (skipped where FastAPI isn't installed), including hot reload."""

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-test-"))

try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except Exception:  # pragma: no cover
    FastAPI = None


@unittest.skipIf(FastAPI is None, "fastapi not installed")
class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(ROOT / "dashboard"))
        import plugin_api
        cls.plugin_api = plugin_api
        app = FastAPI()
        app.include_router(plugin_api.router, prefix="/api/plugins/hermes-artifacts")
        cls.c = TestClient(app)
        from hermes_artifacts import store
        cls.aid = store.publish(path=str(ROOT / "examples" / "dashboard"), title="d", type="dashboard")["id"]

    def get(self, p, **kw):
        return self.c.get("/api/plugins/hermes-artifacts" + p, **kw)

    def post(self, p, body):
        return self.c.post("/api/plugins/hermes-artifacts" + p, json=body)

    def test_routes(self):
        lst = self.get("/artifacts").json()["artifacts"]
        self.assertIn("dashboard", [a["type"] for a in lst])
        r = self.get(f"/artifacts/{self.aid}/html", params={"thumb": "true"}).json()
        self.assertEqual(r["type"], "dashboard")
        self.assertIn('"thumb": true', r["html"])
        self.assertIn("window.hermes", r["html"])
        self.assertEqual(self.get("/vendor/fflate.umd.js").status_code, 200)
        self.assertEqual(self.get("/vendor/..%2Fdashboard%2Fdashboard.js").status_code, 404)
        self.assertEqual(self.get("/artifacts/nope-123").status_code, 404)
        self.assertEqual(self.get("/artifacts/BAD").status_code, 400)
        c = self.post(f"/artifacts/{self.aid}/comments", {"text": "x", "anchor": {"selector": "#a"}}).json()
        self.assertEqual(self.post(f"/artifacts/{self.aid}/comments/{c['id']}/resolve", {"resolved": True}).json()["resolved"], True)
        self.assertTrue(self.post(f"/artifacts/{self.aid}/meta", {"pinned": True}).json()["pinned"])
        self.assertEqual(self.post(f"/artifacts/{self.aid}/op", {"op": "callTool", "args": {}}).status_code, 400)
        self.assertEqual(self.post(f"/artifacts/{self.aid}/op", {"op": "save", "args": {"files": {"x.html": "y"}}}).status_code, 400)

    def test_hot_reload_after_update(self):
        api_file = ROOT / "hermes_artifacts" / "api.py"
        self.get("/artifacts")
        before = sys.modules["hermes_artifacts.api"]
        st = api_file.stat()
        os.utime(api_file, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
        try:
            self.assertEqual(self.get("/artifacts").status_code, 200)
            self.assertIs(sys.modules["hermes_artifacts.api"], before)  # reload keeps the module object
            self.assertEqual(self.plugin_api._stamp, self.plugin_api._code_stamp())
        finally:
            os.utime(api_file, ns=(st.st_atime_ns, st.st_mtime_ns))


if __name__ == "__main__":
    unittest.main()
