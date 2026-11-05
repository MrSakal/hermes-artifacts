"""Render an example folder through the real pipeline into docs/preview/<name>.html (dev helper).

    python scripts/render_preview.py examples/dashboard dashboard
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-preview-"))

from hermes_artifacts import render, store  # noqa: E402
from hermes_artifacts.server import inject_bridge  # noqa: E402

src, kind = sys.argv[1], sys.argv[2]
thumb = "--thumb" in sys.argv
m = store.publish(path=src, title=Path(src).name, type=kind)
html = render.render(m, store.version_dir(m["id"]), thumb=thumb)
out = ROOT / "docs" / "preview" / f"{Path(src).name}{'-thumb' if thumb else ''}.html"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(inject_bridge(html.encode()).decode(), encoding="utf-8")
print(out, len(html))
