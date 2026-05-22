# Track B — Projected 3D (no Three.js dependency)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended). Each PR is one subagent dispatch. The master PR cycle template lives in `2026-05-18-tier-s-master.md`. Phase 2 coordinator: `2026-05-21-phase-2-master.md`.

**Goal:** Add 3D visualization to Glyph by projecting 3D points to 2D **in the compiler**, so the existing SVG/Canvas renderers paint the result unchanged. 80% of "looks 3D" math viz for ~5% of the engineering cost of a full WebGL renderer. **This track gates Track C** — if isometric demos get traction, Three.js follows; if not, stop here.

**Architecture:** Three new coordinate types — `isometric`, `orthographic`, `perspective` — register via Math PR5's coordinate registry. Each consumes a `z` field on data rows and returns 2D screen coordinates. The compiler runs the projection BEFORE handing rows to the scale system; the rest of the pipeline doesn't know 3D exists. Math PR1 already reserved `zExpr?: string` in `FunctionDataSchema` for exactly this moment.

**Tech stack:** Pure TypeScript, no new deps. All projections are basic linear algebra (4×4 matrices). Z-buffer / occlusion / lighting deliberately out of scope — that's Track C.

**Effort:** M (3 PRs, ~2 calendar weeks).

**Validation gate:** Track C only proceeds if Track B's showcase generates demand. See `2026-05-21-phase-2-master.md` § "Validation gates."

---

## File structure

```
packages/core/src/
├── coordinates/
│   ├── projections/
│   │   ├── isometric.ts          # B1
│   │   ├── orthographic.ts       # B1
│   │   ├── perspective.ts        # B1
│   │   └── *.test.ts
│   ├── projections/index.ts      # register the 3 projections via coordinate registry
│   └── transforms.ts             # shared 3×3/4×4 matrix helpers (pure-fn)
├── compiler/
│   ├── compile.ts                # extended to invoke projection before scale
│   └── marks/
│       ├── vector-field-3d.ts    # B2 — extends mark registry
│       └── surface.ts            # B3 — parametric surface as wireframe
├── data/shapes/
│   └── function.ts               # already supports `zExpr`; gain `xyz-grid` shape (B3)
└── spec/{schemas, types}.ts      # extend with 3D-related fields

packages/core/__fixtures__/math3d/
├── parametric-helix.json         # B1 — 3D parametric curve in isometric
├── lorenz-attractor.json         # B1 — classic test for 3D viz
├── vector-field-3d.json          # B2 — rotation field in 3D
├── saddle-surface.json           # B3 — z = x² − y² wireframe
└── torus-knot.json               # B3 — parametric surface
```

---

## Task B1: Isometric / orthographic / perspective coordinate types

**Branch:** `feat/track-b1-3d-coords`

**Goal:** Activate `zExpr` on function data; project (x, y, z) → (screen-x, screen-y) in the compiler.

**Files:**
- Create: `packages/core/src/coordinates/projections/{isometric,orthographic,perspective}.ts`
- Create: `packages/core/src/coordinates/projections/*.test.ts`
- Create: `packages/core/src/coordinates/transforms.ts` (matrix helpers)
- Modify: `packages/core/src/coordinates/registry.ts` — register the 3 projections (registry came from Math PR5)
- Modify: `packages/core/src/compiler/compile.ts` — apply projection before scaling
- Modify: `packages/core/src/spec/schemas.ts` — extend `CoordinatesSchema`
- Create: 2 fixtures + snapshots

**Implementation core:**

```ts
// packages/core/src/coordinates/projections/isometric.ts
import { registerCoordinate } from "../registry.js";

interface IsometricConfig {
  /** Yaw angle (rotation around Z), degrees. Default 30. */
  yaw?: number;
  /** Pitch angle (rotation around X), degrees. Default 25. */
  pitch?: number;
  /** Linear zoom. */
  zoom?: number;
}

registerCoordinate({
  type: "isometric",
  project(point: { x: number; y: number; z?: number }, config: IsometricConfig) {
    const z = point.z ?? 0;
    const yaw = ((config.yaw ?? 30) * Math.PI) / 180;
    const pitch = ((config.pitch ?? 25) * Math.PI) / 180;

    // Standard isometric projection: rotate around Z (yaw), then X (pitch),
    // then drop the Y-axis component (orthographic onto the XZ plane).
    const x1 = point.x * Math.cos(yaw) - point.y * Math.sin(yaw);
    const y1 = point.x * Math.sin(yaw) + point.y * Math.cos(yaw);
    const z1 = z;

    const screenX = x1;
    const screenY = y1 * Math.cos(pitch) - z1 * Math.sin(pitch);
    // Note: we don't return depth — the 2D renderer doesn't z-buffer.
    // Painter's-order optionally applied at the layer level in B3.

    return { x: screenX * (config.zoom ?? 1), y: screenY * (config.zoom ?? 1) };
  },
});
```

```ts
// packages/core/src/coordinates/projections/perspective.ts
registerCoordinate({
  type: "perspective",
  project(point, config: { fov?: number; distance?: number }) {
    // One-point perspective: project onto a plane at z = -distance.
    // distance / (distance - z) is the scale factor; clamps for z near distance.
    const distance = config.distance ?? 10;
    const z = point.z ?? 0;
    const factor = distance / Math.max(distance - z, 0.01);
    return { x: point.x * factor, y: point.y * factor };
  },
});
```

**Updated function-data spec usage:**

```json
{
  "data": {
    "function": {
      "shape": "function",
      "parameter": { "name": "t", "min": 0, "max": 50, "samples": 5000 },
      "xExpr": "10 * cos(t) * cos(0.3*t)",
      "yExpr": "10 * sin(t) * cos(0.3*t)",
      "zExpr": "t / 5"
    }
  },
  "coordinates": { "type": "isometric", "yaw": 30, "pitch": 25 },
  "layers": [{ "mark": "line", "encoding": { "x": "x", "y": "y", "z": "z" } }]
}
```

**Tests:**

- Isometric (0, 0, 0) → screen origin
- Isometric (1, 0, 0), (0, 1, 0), (0, 0, 1) project to 3 distinct screen vectors (visual sanity)
- Same input + config → byte-identical screen coords (closeTo with 1e-12 tolerance)
- Perspective with `distance: 10`, point `(0, 0, 5)` → projected farther from origin than point `(0, 0, 0)` (depth-makes-things-grow check)
- Function data with `zExpr` round-trips through the projection without errors

**Acceptance for B1:**

- 3 projection types registered
- 2 snapshot fixtures (parametric-helix in isometric, Lorenz attractor's first 30s as a 2D-projection trajectory)
- Existing 2D coordinate behavior unchanged (regression-test against the existing snapshot suite)
- Byte-stable across runs

**Effort:** M (~4 days).

PR title: `feat(coords): isometric + orthographic + perspective projections (track B1/3)`.

---

## Task B2: 3D vector-field mark

**Branch:** `feat/track-b2-vector-field-3d`

**Goal:** Extend Math PR3's vector-field mark to handle 3D vectors, drawn as oriented line segments after projection.

**Files:**
- Modify: `packages/core/src/compiler/marks/vector-field.ts` — accept `dz` channel and 3D coords
- Create: `packages/core/src/compiler/marks/vector-field.test.ts` (3D additions)
- Create: `packages/core/__fixtures__/math3d/vector-field-3d.json` + snapshot

**Implementation core:**

```ts
// Extension to vector-field.ts:
registerMark({
  type: "vector-field",
  compile(args) {
    const is3d = args.coordinates.type === "isometric" || /* perspective, etc. */;
    const arrows: SceneMark[] = [];
    for (const row of args.rows) {
      const base = { x: row.x, y: row.y, z: row.z ?? 0 };
      const tip = {
        x: base.x + (row.dx as number) * scale,
        y: base.y + (row.dy as number) * scale,
        z: base.z + (row.dz as number ?? 0) * scale,
      };
      const screenBase = projectionFor(args.coordinates).project(base, args.coordinates);
      const screenTip = projectionFor(args.coordinates).project(tip, args.coordinates);
      arrows.push({ type: "line", x1: screenBase.x, y1: screenBase.y, x2: screenTip.x, y2: screenTip.y });
      // Plus the arrowhead at screenTip — angle = atan2(screenTip.y - screenBase.y, screenTip.x - screenBase.x)
    }
    return arrows;
  },
});
```

**Example:** rotation field `(dx, dy, dz) = (-y, x, 0)` sampled on a 5×5×3 grid → spiraling arrows in isometric projection.

**Acceptance:**

- 3D vector-field renders byte-stably
- 2D vector-field (PR3 from math phase 1) keeps working unchanged
- Snapshot test for rotation-field fixture

**Effort:** S (~2 days).

PR title: `feat(math): 3D vector field through projected coordinates (track B2/3)`.

---

## Task B3: Parametric surface (z = f(x, y))

**Branch:** `feat/track-b3-parametric-surface`

**Goal:** New data shape `surface` + new mark `surface`. Triangulates a `z = f(x, y)` grid into a wireframe (no z-buffer, no fill — that's Track C). Looks 3D enough for educational content.

**Files:**
- Modify: `packages/core/src/data/shapes/function.ts` — add `SurfaceDataSchema`
- Create: `packages/core/src/compiler/marks/surface.ts`
- Create: `packages/core/src/compiler/marks/surface.test.ts`
- Modify: `packages/core/src/spec/schemas.ts`
- Create: 2 fixtures (`saddle-surface.json` for `z = x² − y²`, `torus-knot.json` parametric)

**Implementation core:**

```ts
// packages/core/src/data/shapes/function.ts (extension)
export interface SurfaceDataSpec {
  shape: "surface";
  x: { min: number; max: number; samples: number };
  y: { min: number; max: number; samples: number };
  zExpr: string;       // expr in {x, y}
}

export function sampleSurface(spec: SurfaceDataSpec, evaluator = defaultEvaluator) {
  const rows: { x: number; y: number; z: number | null }[] = [];
  const sx = (spec.x.max - spec.x.min) / (spec.x.samples - 1);
  const sy = (spec.y.max - spec.y.min) / (spec.y.samples - 1);
  for (let i = 0; i < spec.x.samples; i++) {
    for (let j = 0; j < spec.y.samples; j++) {
      const x = spec.x.min + sx * i;
      const y = spec.y.min + sy * j;
      const z = safeEval(evaluator, spec.zExpr, { x, y });
      rows.push({ x, y, z });
    }
  }
  return rows;
}

// packages/core/src/compiler/marks/surface.ts
registerMark({
  type: "surface",
  compile(args) {
    // Draw the wireframe: lines along the i direction (constant j), lines along
    // the j direction (constant i). After projection, that gives the iconic
    // "wireframe surface" look. Optional: paint back-to-front via painter's-order
    // sort by mean-z.
    const lines: SceneMark[] = [];
    // ... triangulate + project + emit line marks ...
    return lines;
  },
});
```

**Example fixture — saddle surface (`z = x² − y²`):**

```json
{
  "version": "0.0.1",
  "data": {
    "function": {
      "shape": "surface",
      "x": { "min": -2, "max": 2, "samples": 20 },
      "y": { "min": -2, "max": 2, "samples": 20 },
      "zExpr": "x*x - y*y"
    }
  },
  "coordinates": { "type": "isometric", "yaw": 35, "pitch": 25 },
  "layers": [{ "mark": "surface", "encoding": { "x": "x", "y": "y", "z": "z" } }]
}
```

**Acceptance:**

- Saddle surface wireframe is recognizable in the snapshot
- Torus-knot parametric surface (`x(u,v) = ..., y(u,v) = ..., z(u,v) = ...`) also renders
- Painter's-order sort delivers reasonable depth illusion (the visible front of the surface obscures the back via line overdrawing)
- Snapshot byte-stable across runs

**Effort:** M (~4 days).

PR title: `feat(math): mark: "surface" + data.shape: "surface" — wireframe 3D function plots (track B3/3)`.

---

## Acceptance criteria for Track B overall

- [ ] All 3 PRs merged
- [ ] 5+ math-3d fixtures with snapshot tests (parametric-helix, lorenz-attractor, vector-field-3d, saddle-surface, torus-knot)
- [ ] Existing 2D coordinate suites unchanged (regression-tested)
- [ ] Zero new MCP verbs
- [ ] Zero new deps
- [ ] Bundle size delta < 8 KB to `@glyph/core`
- [ ] Site `#examples` (math section) gains 5 cards
- [ ] `docs/MATH.md` extended with a "3D in 2D" section
- [ ] `docs/MATH-3D-EVALUATION.md` updated with Track-B traction signal (visit count, sites linking, etc.) at the +30/+60 day mark

---

## Validation signal collection (don't skip)

Before deciding on Track C:

- Add Vercel / GitHub Pages analytics to the math-3d gallery pages so you can read traffic per fixture
- Add a "Want full 3D?" feedback link at the bottom of each Track-B demo page
- Track GitHub issues tagged `3d-request` for 60 days post-launch

Concrete go-criteria for Track C are in the master plan (Gate 1). Re-read before dispatching Track C PRs.

---

## Self-review

**Spec coverage** (against `docs/MATH-3D-EVALUATION.md` §4.3 phase 2a):
- ✅ `coordinates.type: "isometric" | "orthographic" | "perspective"` (B1)
- ✅ 3D vector field (B2)
- ✅ Parametric surface as wireframe (B3)
- ✅ `zExpr` activated (reserved in Math PR1)

**No placeholders:** every PR has files, code skeleton, fixture name, acceptance criteria, effort estimate.

**Foundation principles:**
- ✅ Pure-fn projections (deterministic)
- ✅ Coordinate registry (Math PR5) reused, not re-invented
- ✅ Mark registry (Math PR3) reused for new marks
- ✅ Existing 2D pipeline unchanged when 2D coordinates are used
- ✅ Zero new MCP verbs

**Honest limitations** (documented in `docs/MATH.md`):
- No occlusion — back of a saddle surface bleeds through the front (painter's order helps but doesn't solve)
- No lighting / shading — wireframes only
- No realistic camera moves (you can animate the `yaw` parameter via Math PR2's parametric data, but it's a kludge)
- No interactivity (orbit the view by dragging) without `@glyph/live`

These are the limitations that Track C (Three.js) would fix. If users complain about them, Gate 1 passes.
