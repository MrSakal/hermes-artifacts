"""Render an example folder through the real pipeline into docs/preview/<name>.html (dev helper).

    python scripts/render_preview.py examples/dashboard dashboard
"""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
sys.path.insert(0, str(PLUGIN))
os.environ.setdefault("HERMES_ARTIFACTS_DIR", tempfile.mkdtemp(prefix="hermes-artifacts-preview-"))

from hermes_artifacts import render, store  # noqa: E402
from hermes_artifacts.server import inject_bridge  # noqa: E402

src, kind = sys.argv[1], sys.argv[2]
thumb = "--thumb" in sys.argv
m = store.publish(path=src, title=Path(src).name, type=kind)
html = render.render(m, store.version_dir(m["id"]), thumb=thumb)
out = ROOT / "docs" / "preview" / f"{Path(src).name}{'-thumb' if thumb else ''}{'-live' if '--mock-doc' in sys.argv or '--mock-slides' in sys.argv or '--mock-dash' in sys.argv else ''}.html"
out.parent.mkdir(parents=True, exist_ok=True)
if "--vendor" in sys.argv:  # inline the on-demand export libraries, for testing exports without the bridge
    vend = render.TYPES_DIR / "vendor"
    esc = "<" + chr(92) + "/script"
    tags = "".join("<script>" + (vend / n).read_text("utf-8").replace("</script", esc).replace("<!--", "<" + chr(92) + "!--") + "</script>"
                   for n in ("pptxgen.bundle.js", "pdf-lib.min.js", "fflate.umd.js"))
    a, _, b = html.rpartition("</body>")
    html = a + tags + "</body>" + b
if "--mock-doc" in sys.argv:  # an in-page stand-in for the doc ops, to try the editor without Hermes
    mock = (ROOT / "scripts" / "mock_doc_bridge.js").read_text("utf-8")
    a, _, b = html.partition("</head>")
    html = a + "</head>" + b.replace("<body>", "<body><script>" + mock + "</script>", 1)
if "--mock-slides" in sys.argv:  # save / send / download stand-ins, to try the slide editor without Hermes
    mock = (ROOT / "scripts" / "mock_slides_bridge.js").read_text("utf-8")
    a, _, b = html.partition("</head>")
    html = a + "</head>" + b.replace("<body>", "<body><script>" + mock + "</script>", 1)
if "--mock-dash" in sys.argv:  # a dataset.run stand-in, to try live sources and the Sources panel without Hermes
    mock = (ROOT / "scripts" / "mock_dash_bridge.js").read_text("utf-8")
    a, _, b = html.partition("</head>")
    html = a + "</head>" + b.replace("<body>", "<body><script>" + mock + "</script>", 1)
out.write_text(inject_bridge(html.encode()).decode(), encoding="utf-8")
print(out, len(html))
