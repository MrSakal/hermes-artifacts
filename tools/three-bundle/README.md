# three.bundle.js build

Rebuilds `plugin/hermes_artifacts/types/vendor/three.bundle.js` and copies `three.LICENSE` beside it.
Not shipped: the plugin installs from `plugin/` only.

- Inputs: `entry.js` (which addons go in, and the `window.THREE` namespace), `build.mjs` (esbuild options
  and banner), `package-lock.json` (pins `three@0.187.0` and `esbuild@0.28.2`).
- Every bundled file is unchanged upstream code from the npm `three` package (core, plus addons from
  `three/examples/jsm`, including `geometries/LoftGeometry.js`, `libs/meshopt_decoder.module.js` and
  `libs/fflate.module.js`). Nothing in the bundle is written by this repo except `entry.js`.

```bash
cd tools/three-bundle
npm ci
npm run build
```

The output is byte-identical to the committed bundle
(sha256 `fadd8d50ccfe3a6248ea528ffea2989c31c9c6fe0e77bc2ce99275fd178adb9d`); `git status` should show no change
under `plugin/`.
