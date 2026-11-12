"""Stdlib-only tests: python -m unittest discover -s tests"""

import json
import os
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))

_tmp = tempfile.mkdtemp(prefix="hermes-artifacts-test-")
os.environ["HERMES_ARTIFACTS_DIR"] = _tmp

from hermes_artifacts import store  # noqa: E402
from hermes_artifacts.server import ArtifactServer, Config, inject_bridge  # noqa: E402

PAGE = "<!doctype html><html><head><title>t</title></head><body>hi</body></html>"


class StoreTests(unittest.TestCase):
    def test_publish_versions_same_id(self):
        m1 = store.publish(html=PAGE, title="Report")
        m2 = store.publish(html=PAGE.replace("hi", "v2"), aid=m1["id"])
        self.assertEqual([v["n"] for v in m2["versions"]], [1, 2])
        self.assertIn("v2", store.read_html(m1["id"]))
        self.assertIn("hi", store.read_html(m1["id"], 1))

    def test_rejects_bad_id_and_unknown(self):
        with self.assertRaises(ValueError):
            store.publish(html=PAGE, aid="../evil")
        with self.assertRaises(ValueError):
            store.publish(html=PAGE, aid="Bad Id")

    def test_kv_and_inbox(self):
        aid = store.publish(html=PAGE, title="kv")["id"]
        store.kv_set(aid, "count", 3)
        self.assertEqual(store.kv_all(aid), {"count": 3})
        store.kv_set(aid, "count", None)
        self.assertEqual(store.kv_all(aid), {})
        item = store.inbox_add(aid, "hello", {"x": 1})
        self.assertEqual([i["id"] for i in store.inbox_list(aid)], [item["id"]])
        self.assertEqual(store.inbox_ack([item["id"]]), 1)
        self.assertEqual(store.inbox_list(aid), [])

    def test_inject_bridge_first_in_head(self):
        out = inject_bridge(PAGE.encode()).decode()
        self.assertLess(out.index("window.hermes"), out.index("<title>"))
        self.assertTrue(inject_bridge(b"<p>no head</p>").decode().startswith("<script>"))


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = Config(shell_port=18797, content_port=18798)
        cls.srv = ArtifactServer(cls.cfg).start()
        cls.aid = store.publish(html=PAGE, title="srv")["id"]

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()

    def _req(self, url, method="GET", headers=None, body=None):
        req = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_content_served_with_bridge(self):
        code, body = self._req(f"{self.cfg.content_origin}/c/{self.aid}/v1/index.html")
        self.assertEqual(code, 200)
        self.assertIn(b"window.hermes", body)

    def test_path_traversal_blocked(self):
        code, _ = self._req(f"{self.cfg.content_origin}/c/{self.aid}/v1/..%2Fmeta.json")
        self.assertEqual(code, 404)

    def test_host_header_guard(self):
        code, _ = self._req(f"{self.cfg.shell_origin}/", headers={"Host": "evil.example"})
        self.assertEqual(code, 421)

    def test_api_requires_origin_and_token(self):
        url = f"{self.cfg.shell_origin}/api/{self.aid}/storage.list"
        code, _ = self._req(url, "POST", {"Origin": self.cfg.shell_origin}, b"{}")
        self.assertEqual(code, 403)
        code, body = self._req(url, "POST", {"Origin": self.cfg.shell_origin, "X-Hermes-Token": self.cfg.token,
                                             "Content-Type": "application/json"}, b"{}")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), {"keys": []})

    def test_call_tool_denied_without_allowlist(self):
        url = f"{self.cfg.shell_origin}/api/{self.aid}/callTool"
        code, _ = self._req(url, "POST", {"Origin": self.cfg.shell_origin, "X-Hermes-Token": self.cfg.token},
                            json.dumps({"name": "terminal"}).encode())
        self.assertEqual(code, 403)

    def _csp(self, url):
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.headers.get("Content-Security-Policy", "")

    def test_frame_ancestors_default_self(self):
        """No other site frames the viewer; the viewer still frames the artifact content."""
        shell = self._csp(f"{self.cfg.shell_origin}/a/{self.aid}")
        self.assertIn("frame-ancestors 'self'", shell)
        self.assertIn(f"frame-src {self.cfg.content_origin}", shell)
        content = self._csp(f"{self.cfg.content_origin}/c/{self.aid}/v1/index.html")
        self.assertEqual(content, "frame-ancestors http://127.0.0.1:18797 http://localhost:18797")
        self.assertNotIn("'self'", content)  # 'self' on the content port would mean the content origin

    def test_frame_ancestors_ignores_the_old_env_var(self):
        os.environ["HERMES_ARTIFACTS_FRAME_ANCESTORS"] = "*"
        try:
            self.assertEqual(Config().frame_ancestors, "'self'")
        finally:
            del os.environ["HERMES_ARTIFACTS_FRAME_ANCESTORS"]

    def test_frame_ancestors_override(self):
        cfg = Config(shell_port=18799, content_port=18800, frame_ancestors=" 'self'  https://hub.example ")
        srv = ArtifactServer(cfg).start()
        try:
            self.assertIn("frame-ancestors 'self' https://hub.example", self._csp(f"{cfg.shell_origin}/"))
            self.assertEqual(self._csp(f"{cfg.content_origin}/c/{self.aid}/v1/index.html"),
                             "frame-ancestors http://127.0.0.1:18799 http://localhost:18799 https://hub.example")
        finally:
            srv.stop()
        anyone = Config(frame_ancestors="*")
        self.assertIsNone(anyone.content_frame_ancestors())  # any framer of the shell: content sends none


class PluginConfigTests(unittest.TestCase):
    def test_frame_ancestors_is_a_plugin_setting(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("hermes_artifacts_plugin", PLUGIN / "__init__.py",
                                                      submodule_search_locations=[str(PLUGIN)])
        p = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = p
        spec.loader.exec_module(p)

        class Ctx:
            def __init__(self, conf):
                self.conf = conf

            def get_config(self, key):
                return self.conf.get(key)

        old = p._ctx
        try:
            p._ctx = Ctx({})
            self.assertEqual(p._cfg().frame_ancestors, "'self'")
            p._ctx = Ctx({"frame_ancestors": "https://hub.example"})
            self.assertEqual(p._cfg().frame_ancestors, "https://hub.example")
        finally:
            p._ctx = old
        yml = (PLUGIN / "plugin.yaml").read_text("utf-8")
        self.assertIn("  frame_ancestors:\n    type: str\n    default: \"'self'\"\n", yml.replace("\r\n", "\n"))


if __name__ == "__main__":
    unittest.main()
