// Builds plugin/hermes_artifacts/types/vendor/three.bundle.js (and three.LICENSE beside it)
// from the pinned npm packages in package-lock.json. Run: npm ci && npm run build
import { build } from 'esbuild';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const vendor = join(here, '..', '..', 'plugin', 'hermes_artifacts', 'types', 'vendor');
const out = join(vendor, 'three.bundle.js');

const banner = '/*! three.js r187 (npm three@0.187.0) | @license MIT | Copyright 2010-2026 three.js authors | see three.LICENSE. Includes the meshoptimizer decoder (MIT, Copyright 2016-2026 Arseny Kapoulkine) and fflate (MIT, Copyright 2026 Arjun Barrett). One classic script: window.THREE = core namespace + addons (OrbitControls, TransformControls, GLTFLoader, GLTFExporter, MeshoptDecoder, OBJLoader, MTLLoader, OBJExporter, STLLoader, STLExporter, PLYLoader, PLYExporter, ThreeMFLoader, SVGLoader, BufferGeometryUtils, ConvexGeometry, RoundedBoxGeometry, LoftGeometry, Line2, LineSegments2, LineMaterial, LineGeometry, LineSegmentsGeometry, CSS2DRenderer, CSS2DObject). */';

const result = await build({
  absWorkingDir: here,
  entryPoints: ['entry.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'chrome120',
  legalComments: 'inline',
  charset: 'ascii',
  banner: { js: banner },
  write: false,
  logLevel: 'warning',
});

// The bundle is inlined into a <script> element: never let it close or comment out that element.
const code = result.outputFiles[0].text.replace(/<\/script/g, '<\\/script').replace(/<!--/g, '<\\!--');
writeFileSync(out, code);
copyFileSync(join(here, 'node_modules', 'three', 'LICENSE'), join(vendor, 'three.LICENSE'));
console.log(`${out} (${readFileSync(out).length} bytes)`);
