# Track C — `@glyph/three` — Full WebGL Renderer

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended). Each PR is one subagent dispatch. The master PR cycle template lives in `2026-05-18-tier-s-master.md`. Phase 2 coordinator: `2026-05-21-phase-2-master.md`.
>
> **DO NOT START Track C until Master Plan Gate 1 has passed.** See `2026-05-21-phase-2-master.md` § "Validation gates." Track B's traction signal is the precondition.

**Goal:** Promote Glyph from "best-in-class 2D + projected-3D math viz" to "leading agent-native 3D math + physics + engineering renderer." Catch up to MathBox-level visual capability while keeping the agent-callable, deterministic, MCP-native pitch.

**Architecture:** A new workspace package `@glyph/three` that:

1. Ships a new `Scene3D` IR alongside the existing 2D `Scene`. Compiler dispatches based on `coordinates.type`.
2. Wraps Three.js for the rendering. New marks: `sphere`, `box`, `mesh`, `surface`, `point-cloud`, `vector-arrow-3d`, `parametric-surface`, `line-3d`.
3. Adds `camera` (position, target, up, fov) + optional `lights` (ambient, directional, point) as spec fields.
4. Renders server-side via headless WebGL (`gl` npm) → PNG bytes for the agent-native path.
5. Renders browser-side via standard Three.js for `@glyph/live` integration (orbit controls, raycasting).
6. **Zero new MCP verbs.** Same `glyph_render` call; the agent picks 3D by setting `coordinates.type: "cartesian-3d"` (or one of the new 3D types).

**Tech stack:**
- `three@^0.169` (~600 KB minified gzipped)
- `gl@^8.1` for headless WebGL on Node (Linux, macOS, Windows binary)
- `@types/three` (dev only)
- All other infrastructure inherited from `@glyph/core`

**Effort:** L (10 PRs, ~10 calendar weeks).

**Determinism contract** (different from `@glyph/core`):
- **Server-side via headless GL:** deterministic on identical driver + Three.js version. CI pins a Linux-only cell for snapshot tests; other platforms run "visual equivalence" tests with a small pixel-diff tolerance.
- **Browser-side:** visually equivalent across modern GPUs, but byte-stable across browsers is NOT a contract.

This is the **only** deliberate departure from Glyph's byte-identity contract anywhere in the stack. Documented prominently in `docs/3D.md`.

---

## File structure

```
packages/three/                              # new workspace package
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                             # public API
│   ├── render.ts                            # renderScene3D() — Three.js + headless gl
│   ├── browser.ts                           # renderScene3DBrowser() — live canvas
│   ├── scene3d/
│   │   ├── types.ts                         # Scene3D IR
│   │   ├── camera.ts                        # Camera helpers (position/target/lookAt)
│   │   └── lights.ts                        # Light helpers
│   ├── marks/
│   │   ├── sphere.ts
│   │   ├── box.ts
│   │   ├── mesh.ts
│   │   ├── surface.ts                       # parametric z = f(x,y)
│   │   ├── point-cloud.ts
│   │   ├── vector-arrow-3d.ts
│   │   ├── line-3d.ts
│   │   └── *.test.ts
│   ├── animation/
│   │   ├── orbit.ts                         # animation.kind: "orbit"
│   │   ├── fly.ts                           # animation.kind: "fly"
│   │   └── frames.ts                        # multi-frame PNG export
│   └── headless/
│       ├── gl-context.ts                    # gl npm setup
│       └── png-export.ts
├── tests/
│   └── ... (snapshot tests against committed PNG fixtures)
└── __fixtures__/3d/
    ├── lorenz-attractor.json
    ├── klein-bottle.json
    ├── torus-knot.json
    ├── n-body.json
    ├── molecular.json
    └── ... + .png snapshots

packages/core/src/
├── scenegraph/types.ts                       # ADD Scene3D type as a sibling of Scene
├── compiler/compile.ts                       # ADD dispatch: 3D coords → Scene3D
└── coordinates/projections/
    ├── cartesian-3d.ts                       # registers as a "3D-aware" coordinate
    └── cartesian-3d.test.ts

packages/mcp/src/
└── server.ts                                # ADD a renderer field in the render
                                              #     verb args; routes 3D to @glyph/three

site/three/                                   # new dedicated site for 3D showcases
├── index.html
├── lorenz/
├── klein/
└── ... (8+ live demos)
```

---

## Task C1: Package scaffold + headless renderer

**Branch:** `feat/track-c1-three-scaffold`

**Files:**
- Create: `packages/three/{package.json, tsconfig.json, README.md, src/index.ts, src/render.ts, src/headless/{gl-context.ts, png-export.ts}}`
- Modify: `pnpm-workspace.yaml` (already includes `packages/*`)

**Implementation core:**

```ts
// packages/three/src/render.ts
import * as THREE from "three";
import createGL from "gl";
import { PNG } from "pngjs";

export interface Render3DOptions {
  width: number;
  height: number;
  // ...
}

export function renderScene3D(scene3d: Scene3D, options: Render3DOptions): Buffer {
  // 1. Spawn headless GL context
  const gl = createGL(options.width, options.height);
  // 2. Build Three.js scene from Scene3D IR
  const scene = new THREE.Scene();
  // ... (camera, lights, marks)
  // 3. Render to framebuffer
  const renderer = new THREE.WebGLRenderer({ context: gl, antialias: true });
  renderer.render(scene, camera);
  // 4. Read pixels from GL, encode to PNG
  const pixels = new Uint8Array(options.width * options.height * 4);
  gl.readPixels(0, 0, options.width, options.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  // 5. Flip Y, pack as PNG, return Buffer
  return pngFromRgba(pixels, options.width, options.height);
}
```

**This PR is the validation gate (Gate 2 in the master plan).** Verify:

```bash
# Generate a known-input PNG on this machine
pnpm --filter @glyph/three test -- --update-snapshots
# Push to PR; CI runs on Linux + macOS + Windows
# Compare PNG bytes across cells
```

If bytes differ even on identical inputs, document and decide:
- Pin CI to Linux-only for 3D snapshot tests
- Or, accept "tolerance-based pixel diff" (`pixelmatch` npm) as the regression gate

Acceptance:
- `renderScene3D({...minimum example...}, {width: 400, height: 300})` returns a non-empty PNG Buffer
- A snapshot PNG fixture is committed and the test passes
- Bundle size with all deps: documented in PR description

PR title: `feat(three): @glyph/three scaffold + headless WebGL renderer (track C1/10)`.

---

## Task C2: Scene3D IR + compiler dispatch

**Branch:** `feat/track-c2-scene3d-ir`

**Files:**
- Modify: `packages/core/src/scenegraph/types.ts` — add `Scene3D` interface
- Modify: `packages/core/src/compiler/compile.ts` — dispatch on `coordinates.type`
- Create: `packages/core/src/coordinates/projections/cartesian-3d.ts`
- Modify: `packages/core/src/coordinates/projections/index.ts` (register)

**Scene3D IR:**

```ts
// packages/core/src/scenegraph/types.ts (additions)
export interface Scene3D {
  readonly kind: "3d";
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly camera: {
    readonly type: "perspective" | "orthographic";
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly up: readonly [number, number, number];
    readonly fov?: number;
  };
  readonly lights?: ReadonlyArray<{
    readonly type: "ambient" | "directional" | "point";
    readonly color: string;
    readonly intensity: number;
    readonly position?: readonly [number, number, number];
  }>;
  readonly marks3D: ReadonlyArray<SceneMark3D>;
}

// SceneMark3D is the discriminated union over 3D-specific mark types:
// sphere, box, mesh, surface, point-cloud, vector-arrow-3d, line-3d.
```

**Compiler dispatch:**

```ts
// packages/core/src/compiler/compile.ts
export function compileSpec(args): Scene | Scene3D {
  const coords = args.spec.coordinates ?? { type: "linear" };
  if (coords.type === "cartesian-3d" || coords.type === "cylindrical" || coords.type === "spherical") {
    return compileSpec3D(args);
  }
  return compileSpec2D(args); // existing path; renamed for clarity
}
```

Acceptance:
- `coordinates.type: "cartesian-3d"` produces a `Scene3D`; everything else stays `Scene`
- The `@glyph/three` package can consume `Scene3D` directly
- Existing 2D tests unchanged

PR title: `feat(core): Scene3D IR + 3D-coords compiler dispatch (track C2/10)`.

---

## Task C3: Sphere / box / mesh primitives

**Branch:** `feat/track-c3-3d-primitives`

**Files:**
- Create: `packages/three/src/marks/{sphere,box,mesh}.ts`
- Create: `packages/three/src/marks/*.test.ts`
- Modify: `packages/core/src/spec/schemas.ts` — `SphereMarkSchema`, `BoxMarkSchema`, `MeshMarkSchema`
- Create: 2 fixtures (e.g. `n-body.json` with 5 spheres at varied positions)

**Spec example:**

```json
{
  "coordinates": { "type": "cartesian-3d" },
  "camera": { "type": "perspective", "position": [5,5,5], "target": [0,0,0], "fov": 50 },
  "lights": [
    { "type": "ambient", "color": "#404040", "intensity": 0.4 },
    { "type": "directional", "color": "#ffffff", "intensity": 0.8, "position": [10,10,10] }
  ],
  "layers": [
    { "mark": "sphere", "data": {"values":[{"x":0,"y":0,"z":0,"r":1.5,"c":"#4c78a8"}]},
      "encoding": { "x": "x", "y": "y", "z": "z", "size": "r", "color": "c" } }
  ]
}
```

Acceptance:
- Sphere + box + arbitrary mesh marks compile to Scene3D
- N-body fixture renders; snapshot PNG byte-stable on the pinned CI cell

PR title: `feat(three): sphere + box + mesh marks (track C3/10)`.

---

## Task C4: Parametric surfaces with full 3D rendering

**Branch:** `feat/track-c4-parametric-surface`

**Goal:** The full-3D version of Track B3's wireframe surface. Includes z-buffer occlusion, optional shading.

**Files:**
- Create: `packages/three/src/marks/surface.ts` — uses `THREE.ParametricGeometry` or builds a `BufferGeometry` from triangulated `z = f(x,y)`
- Create: 2 fixtures (Klein bottle, torus knot, both as parametric surfaces)

Acceptance:
- Saddle surface from Track B3 renders again, now with proper depth + shading
- Klein bottle + torus knot fixtures
- Visual quality matches MathBox's equivalent

PR title: `feat(three): parametric surfaces with z-buffer + shading (track C4/10)`.

---

## Task C5: 3D vector fields + point clouds

**Branch:** `feat/track-c5-vector-3d-and-points`

**Files:**
- Create: `packages/three/src/marks/{vector-arrow-3d, point-cloud}.ts`
- Fixtures: electric-field, point-cloud-galaxy (1M+ points to validate scale)

Acceptance:
- 1M-point cloud renders at 60fps in browser, < 5s headless on Linux runner
- Vector arrows have proper 3D shading (lambert)
- Snapshot PNG byte-stable

PR title: `feat(three): vector-arrow-3d + point-cloud marks (track C5/10)`.

---

## Task C6: Camera animation — orbit + fly-through

**Branch:** `feat/track-c6-camera-animation`

**Files:**
- Create: `packages/three/src/animation/{orbit,fly,frames}.ts`
- Modify: `packages/core/src/spec/schemas.ts` — extend `AnimationSchema` with `"orbit"` and `"fly"` kinds
- Create: a Lorenz attractor fixture with an orbiting camera

**Spec example:**

```json
{
  "coordinates": { "type": "cartesian-3d" },
  "camera": { /* ... */ },
  "layers": [{ "mark": "line-3d", "data": { /* trajectory from Track A1 */ } }],
  "animation": {
    "kind": "orbit",
    "duration_ms": 12000,
    "target": [0, 0, 0],
    "distance": 30,
    "elevation_deg": 25
  }
}
```

The renderer produces N frames as PNGs; a follow-up tool can stitch them via ffmpeg.

Acceptance:
- Orbit + fly-through animations render N frames deterministically
- Render time for 120-frame orbit on a 800×600 fixture: < 30s on a 2024 laptop

PR title: `feat(three): camera animation — orbit + fly-through (track C6/10)`.

---

## Task C7: Optional lighting + materials

**Branch:** `feat/track-c7-lights-materials`

**Files:**
- Modify: `packages/three/src/scene3d/lights.ts`
- Modify: every mark to consume a `material` field
- Fixtures: same primitives with various material/lighting combos

**Material types:**
- `"basic"` (no lighting, flat color — default for speed)
- `"lambert"` (diffuse shading)
- `"phong"` (specular highlights — useful for spheres, molecules)
- `"physical"` (PBR — for rare engineering-grade renders)

Acceptance:
- Same fixture with `"basic"` vs `"phong"` materials shows visibly different output
- Documented in `docs/3D.md` with a comparison gallery

PR title: `feat(three): optional lighting + materials (track C7/10)`.

---

## Task C8: Browser-side live renderer + @glyph/live integration

**Branch:** `feat/track-c8-browser-live`

**Files:**
- Create: `packages/three/src/browser.ts`
- Modify: `packages/live/src/index.ts` — export `attachThreeRenderer(host, spec)`

**Browser entry:**

```ts
// packages/three/src/browser.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function renderScene3DBrowser(host: HTMLElement, scene3d: Scene3D) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);
  // ... build THREE.Scene from Scene3D
  const controls = new OrbitControls(camera, renderer.domElement);
  // Re-render on each frame; controls expose orbit/zoom/pan
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();
  return { dispose: () => {/* cleanup */} };
}
```

Acceptance:
- Drag-to-orbit works in the playground for the Lorenz attractor fixture
- Raycasting + tooltips on hover (over sphere marks)
- Bundle size for the browser path: ~600 KB minified (Three.js + addons + Glyph code)

PR title: `feat(three): browser-side live renderer + orbit controls (track C8/10)`.

---

## Task C9: 3D streamlines + 3D vector field showcase

**Branch:** `feat/track-c9-3d-streamlines-physics`

**Files:**
- Create: `packages/three/src/marks/streamline-3d.ts` — RK4 integration through a 3D vector field
- Fixtures: electromagnetic dipole field, fluid-flow simulation, magnetic-field-around-wire

Acceptance:
- 3D streamlines render with proper occlusion + depth
- 3 physics-flavored fixtures committed
- Materials make the streamlines visually distinct (e.g. color by speed)

PR title: `feat(three): 3D streamlines for physics + engineering viz (track C9/10)`.

---

## Task C10: Showcase + docs

**Branch:** `feat/track-c10-showcase`

**Files:**
- Create: `site/three/index.html` — top-level showcase page with 8+ live demos
- Create: `docs/3D.md` — user-facing "Glyph for 3D math + physics + engineering"
- Modify: `README.md` — add 3D section
- Modify: `site/index.html` — add a `#3d` section linking out to `site/three/`

**`docs/3D.md` covers:**
1. Quick example (Lorenz attractor in 30 lines of JSON)
2. The 8 new 3D marks
3. Camera + lighting + materials
4. Animation: orbit + fly-through
5. Determinism: headless GL byte-stability on the pinned CI cell, visual equivalence elsewhere
6. Performance: 1M points at 60fps in browser, 30s for 120-frame headless animation
7. What Glyph 3D deliberately does NOT do: real-time game physics, hand-authored shaders, AR/VR
8. Comparison with MathBox / Three.js direct / Plotly: agent-native + deterministic + spec-as-JSON

**Live demos in `site/three/`:**

1. Lorenz attractor with orbit camera
2. Klein bottle, rotating
3. Electric-field arrows around a +/- dipole
4. Saddle surface with shading
5. Torus knot
6. N-body orbital mechanics (animated)
7. 1M-point cloud galaxy
8. Crystal lattice with atoms + bonds
9. (Bonus) Quantum wavefunction `|ψ(x,y,z)|²` as a 3D scatter
10. (Bonus) Finite-element mesh of a beam under load — engineering use case

Acceptance for C10:
- `site/three/` deploys via the existing GH Pages pipeline
- All 8 mandatory demos render in browser
- `docs/3D.md` complete with screenshots
- README + landing site updated
- Each demo specifies the EXACT JSON spec used + the agent prompt that would generate it (proves the agent-native claim)

PR title: `feat(three): showcase + docs (track C10/10)`.

---

## Acceptance criteria for Track C overall

- [ ] All 10 PRs merged
- [ ] `@glyph/three` published to npm
- [ ] Headless renderer deterministic on the pinned CI cell; visual-equivalence on others
- [ ] 8+ 3D marks shipped
- [ ] 10+ 3D fixtures with snapshot tests (PNG)
- [ ] `glyph_render` accepts 3D specs via `coordinates.type: "cartesian-3d"` — no new MCP verbs
- [ ] `site/three/` has 8+ live demos
- [ ] `docs/3D.md` is complete and links out from README + landing
- [ ] Bundle size for `@glyph/core` unchanged (3D code is in `@glyph/three` only)
- [ ] Performance benchmarks documented:
  - Headless render of a 800×600 sphere scene: < 1s
  - Headless render of 120-frame orbit animation: < 30s
  - Browser live render of 1M point cloud: 60fps

---

## What this unlocks (the marketing surface)

Use cases that nothing in `awesome-interactive-math` ships with the same combination of (agent-callable + deterministic + MCP-native):

- **Math education**: animated Riemann surfaces, sphere eversion, geodesics, hyperbolic tilings
- **Physics**: orbital mechanics, electromagnetic fields, quantum wavefunctions, phase portraits
- **Chemistry**: molecular structures, crystal lattices, MO surfaces
- **Engineering**: finite-element stress maps, fluid flow, CAD review previews
- **Data**: large point clouds (1M+), 3D scatter, contour surfaces over (x, y, z)
- **AI/ML**: t-SNE / UMAP 3D embeddings, loss landscapes, GAN latent space walks

For each, an agent can generate the spec and the agent's user gets back a deterministic PNG (server) or an interactive embed (browser). No SaaS, no API key, no telemetry.

---

## Self-review

**Spec coverage** (against `docs/MATH-3D-EVALUATION.md` §4.3 phase 2b):
- ✅ Three.js + headless GL → deterministic server-side rendering (C1)
- ✅ Scene3D IR + compiler dispatch (C2)
- ✅ Sphere + box + mesh primitives (C3)
- ✅ Parametric surfaces with proper depth + shading (C4)
- ✅ Vector arrows + point clouds (C5)
- ✅ Camera animation (C6)
- ✅ Lights + materials (C7)
- ✅ Browser-side live renderer + orbit controls (C8)
- ✅ 3D streamlines for physics (C9)
- ✅ Showcase + docs (C10)

**No placeholders:** every PR has files, code skeleton, fixture name, acceptance criteria. The PR descriptions are deliberately tighter than Tracks A/B's because each Track-C PR is mostly Three.js wiring rather than novel pure-math code.

**Foundation principles:**
- ✅ Zero new MCP verbs (spec extensions only)
- ✅ Determinism explicit (and the deviation from byte-identity is documented)
- ✅ Bundle-size opt-in (Three.js stays in `@glyph/three`)
- ✅ Scene-graph extension is additive (existing 2D `Scene` unchanged)
- ✅ Mark + coordinate registries reused

**Honest risks:**
- Track C is the biggest commitment in Phase 2 (10 PRs, ~10 weeks). Don't start without Gate 1 traction signal.
- WebGL determinism across hardware is genuinely tricky. PR C1 is the load-bearing experiment.
- Three.js's API evolves. Pinning at `^0.169` exposes us to minor-version drift. Track to Three.js upstream changes; one PR every ~6 months for upgrades.
