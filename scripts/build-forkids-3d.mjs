#!/usr/bin/env node
/**
 * Build site/forkids-3d.js from site/forkids-3d-src/index.js.
 *
 * The bundled artifact ships to GitHub Pages alongside site/forkids.html
 * and is lazy-loaded by IntersectionObserver when §3.5 ("Math gets weird
 * in 3D") scrolls into view. Tree-shakes three.js + OrbitControls down to
 * just the geometries, materials, and renderer the two demos use.
 *
 * The build is intentionally NOT wired into a watcher or pre-commit
 * hook. Run this manually after editing site/forkids-3d-src/ and commit
 * the regenerated bundle alongside the source. Pinning the artifact in
 * git matches the existing playground bundle pattern in
 * scripts/build-playground-bundle.mjs — Pages deploys what's in main, so
 * the bundle has to be a tracked file.
 *
 * Why iife (not esm): GitHub Pages serves *.js with no special headers;
 * a kid landing on this page expects the demos to just work. iife loads
 * everywhere without requiring `<script type="module">` semantics in the
 * lazy-injected <script> tag.
 */

import { build } from "esbuild";

await build({
  entryPoints: ["site/forkids-3d-src/index.js"],
  outfile: "site/forkids-3d.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  logLevel: "info",
});
