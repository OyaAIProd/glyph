# Track A — Tactical Math Extensions

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended). Each PR is one subagent dispatch. The master PR cycle template lives in `2026-05-18-tier-s-master.md`. Phase 2 coordinator: `2026-05-21-phase-2-master.md`.

**Goal:** Close the tactical math gaps after Phase 1 — ODE solvers, pen-draw animations, streamlines, interactive sliders, bezier construction visualizer, chalkboard theme. Each PR ships standalone inside the grammar; no architectural rewrites.

**Architecture:** Each new capability is one of three kinds:
- **New `data.shape`** that compiles to rows the existing marks consume (PR A1, A3)
- **New `animation.kind`** that hooks into the existing animation engine (PR A2)
- **New `mark` type** registered via Math PR3's mark registry (PR A5)
- **Theme extension** to the existing theme system (PR A6)
- **Cross-package work** in `@glyph/live` for interactivity that the static-SVG renderer can't do (PR A4)

**Tech stack:** Same as `@glyph/core` (TypeScript strict, Zod, biome, vitest). No new dependencies for PRs A1–A6 except possibly `simplex-noise` (1.5 KB) for the chalkboard theme.

**Effort:** M (6 PRs, ~4 calendar weeks).

**Validation:** ship the math extension showcase gallery (Math PR6) with Track A's marks/shapes added. ≥ 8 demos from this track in the public site by the end.

---

## File structure (new across PRs)

```
packages/core/src/
├── data/shapes/
│   ├── trajectory.ts                # A1 — RK4 ODE solver
│   └── trajectory.test.ts
├── compiler/marks/
│   ├── bezier.ts                    # A5 — bezier construction mark
│   ├── streamline.ts                # A3 — streamline mark
│   └── *.test.ts
├── render/svg.ts                    # extended for draw-in animation (A2)
└── themes/
    ├── chalkboard.ts                # A6 — theme tokens + path filter
    └── chalkboard.test.ts

packages/live/src/
├── slider.ts                        # A4 — slider component
└── slider.test.ts

packages/core/__fixtures__/math/
├── damped-oscillator.json           # A1 fixture
├── predator-prey.json               # A1 fixture
├── pen-draw-fourier.json            # A2 fixture
├── velocity-field-streamlines.json  # A3 fixture
├── bezier-cubic.json                # A5 fixture
└── chalkboard-decay.json            # A6 fixture
```

---

## Task A1: RK4 ODE solver — `data.shape: "trajectory"`

**Branch:** `feat/track-a1-rk4-trajectory`

**Goal:** Let an agent describe a dynamical system as `{dxdt: <expr>, dydt: <expr>, initial: {x, y}, time: {min, max, samples}}` and get back a trajectory the line mark can render.

**Files:**
- Create: `packages/core/src/data/shapes/trajectory.ts`
- Create: `packages/core/src/data/shapes/trajectory.test.ts`
- Modify: `packages/core/src/spec/schemas.ts` (add `TrajectoryDataSchema`)
- Modify: `packages/core/src/spec/types.ts` (mirror)
- Modify: `packages/core/src/compiler/compile.ts` (dispatch)
- Create: `packages/core/__fixtures__/math/{damped-oscillator,predator-prey}.json` + snapshots

**Implementation core:**

```ts
// packages/core/src/data/shapes/trajectory.ts
export interface TrajectoryDataSpec {
  shape: "trajectory";
  dxdt: string;                                   // expr in {x, y, t}
  dydt: string;
  initial: { x: number; y: number };
  time: { min: number; max: number; samples: number };
}

export interface TrajectoryRow {
  t: number;
  x: number | null;
  y: number | null;
}

const MAX_SAMPLES = 100_000;

export function sampleTrajectory(
  spec: TrajectoryDataSpec,
  evaluator: Evaluator = defaultEvaluator,
): TrajectoryRow[] {
  if (spec.time.min >= spec.time.max) throw new Error(/* ... */);
  if (spec.time.samples > MAX_SAMPLES) throw new Error(/* ... */);

  const h = (spec.time.max - spec.time.min) / (spec.time.samples - 1);
  let x = spec.initial.x;
  let y = spec.initial.y;
  const rows: TrajectoryRow[] = [{ t: spec.time.min, x, y }];

  for (let i = 1; i < spec.time.samples; i++) {
    const t = spec.time.min + h * i;
    // Classic RK4
    try {
      const k1x = evaluator(spec.dxdt, { x, y, t });
      const k1y = evaluator(spec.dydt, { x, y, t });
      const k2x = evaluator(spec.dxdt, { x: x + h*k1x/2, y: y + h*k1y/2, t: t + h/2 });
      const k2y = evaluator(spec.dydt, { x: x + h*k1x/2, y: y + h*k1y/2, t: t + h/2 });
      const k3x = evaluator(spec.dxdt, { x: x + h*k2x/2, y: y + h*k2y/2, t: t + h/2 });
      const k3y = evaluator(spec.dydt, { x: x + h*k2x/2, y: y + h*k2y/2, t: t + h/2 });
      const k4x = evaluator(spec.dxdt, { x: x + h*k3x, y: y + h*k3y, t: t + h });
      const k4y = evaluator(spec.dydt, { x: x + h*k3x, y: y + h*k3y, t: t + h });
      x += (h / 6) * (k1x + 2*k2x + 2*k3x + k4x);
      y += (h / 6) * (k1y + 2*k2y + 2*k3y + k4y);
      rows.push({ t, x, y });
    } catch {
      // Non-finite at this step — break the trajectory (null y) and stop
      rows.push({ t, x: null, y: null });
      break;
    }
  }
  return rows;
}
```

**Example fixture — damped oscillator (`d²x/dt² + 0.1 dx/dt + x = 0`)**, expressed as a 2D first-order system with `y = dx/dt`:

```json
{
  "version": "0.0.1",
  "data": {
    "trajectory": {
      "shape": "trajectory",
      "dxdt": "y",
      "dydt": "-x - 0.1*y",
      "initial": { "x": 1, "y": 0 },
      "time": { "min": 0, "max": 50, "samples": 1000 }
    }
  },
  "layers": [{ "mark": "line", "encoding": { "x": "x", "y": "y" } }],
  "coordinates": { "type": "linear" },
  "scales": { "x": { "domain": [-1.2, 1.2] }, "y": { "domain": [-1.2, 1.2] } }
}
```

**Tests:**
- Linear system `dxdt=y, dydt=-x` with initial `(1,0)` traces a unit circle — assert `x[i]² + y[i]² ≈ 1` within RK4 tolerance for all `i`.
- Byte-identical across two calls (same inputs → same trajectory bytes).
- `MAX_SAMPLES` enforced.
- Non-finite expression at step N → trajectory truncates at step N.

**Acceptance:**
- 4+ tests pass; snapshot fixtures (damped oscillator + predator-prey) lock byte-identity.
- Reuses existing `Evaluator` interface (pluggable, deterministic).
- Audit rule AUDIT-12 (planned in math PR5 for sample count) automatically applies via the same dispatcher.

**Effort:** M (~5 days).

PR title: `feat(math): data.shape: "trajectory" — RK4 ODE solver (track A1/6)`.

---

## Task A2: Pen-draw animation — `animation.kind: "draw-in"`

**Branch:** `feat/track-a2-draw-in-animation`

**Goal:** Manim's `Create(line)` equivalent. The chart shows a stroke being drawn from start to end over the duration.

**Files:**
- Modify: `packages/core/src/spec/schemas.ts` — add `"draw-in"` to the `AnimationSchema` discriminated union
- Modify: `packages/core/src/render/svg.ts` — for line/path/area marks under a `draw-in` animation, compute the path length (`getTotalLength()` analog) and emit SMIL:
  ```xml
  <animate attributeName="stroke-dashoffset"
           from="L" to="0"
           dur="<duration>" repeatCount="indefinite" />
  <line ... stroke-dasharray="L L" stroke-dashoffset="L" />
  ```
- Create: `packages/core/__fixtures__/math/pen-draw-fourier.json` (a Fourier partial sum drawn in, looks beautiful in motion)

**Implementation note:**

Computing exact path length for SVG paths requires either:
1. **Numeric arc-length integration** — pure-fn, deterministic. ~50 LOC for our subset (M, L, C only — no A arcs in the marks where draw-in applies).
2. **Hand-wavy upper bound** — use the path's bounding-box diagonal × 2. Cheaper, slightly off visually.

Pick option 1 since byte-identity matters.

**Test:** the fixture renders identically across runs; a future regression in path-length math fails the snapshot.

**Acceptance:**
- `animation.kind: "draw-in"` works on `line`, `path`, `area` marks.
- Bezier curves draw smoothly.
- Snapshot test for the Fourier partial-sum fixture locks the SMIL output.
- Doc snippet in `docs/MATH.md` (lands as part of math PR6 — Track A1 ships an addendum here).

**Effort:** S (~2 days).

PR title: `feat(math): animation.kind: "draw-in" — Manim Create equivalent (track A2/6)`.

---

## Task A3: Streamlines mark

**Branch:** `feat/track-a3-streamlines`

**Goal:** Given a 2D vector field, draw streamlines that integrate along the flow from seed points.

**Files:**
- Create: `packages/core/src/compiler/marks/streamline.ts` — registers `mark: "streamline"` via Math PR3's mark registry
- Create: `packages/core/src/compiler/marks/streamline.test.ts`
- Modify: `packages/core/src/spec/schemas.ts` — `StreamlineMarkSchema`
- Create: `packages/core/__fixtures__/math/velocity-field-streamlines.json` + snapshot

**Implementation core:**

```ts
// packages/core/src/compiler/marks/streamline.ts
registerMark({
  type: "streamline",
  compile(args) {
    // Spec:
    // { mark: "streamline",
    //   vectorField: { dx: <expr>, dy: <expr> },  // in {x, y}
    //   seeds: [{x, y}, ...] OR { grid: {...} },
    //   length: 50,  // number of RK4 steps per seed
    //   stepSize: 0.05 }
    const layer = args.layer as StreamlineLayer;
    const paths: SceneMark[] = [];
    for (const seed of resolveSeeds(layer.seeds)) {
      const polyline = rk4Integrate(
        layer.vectorField.dx,
        layer.vectorField.dy,
        seed,
        layer.length,
        layer.stepSize,
      );
      paths.push({
        type: "path",
        d: polylineToSvgD(polyline.map((p) => [args.scales.x(p.x), args.scales.y(p.y)])),
        stroke: "#4c78a8",
        strokeWidth: 1,
        fill: "none",
      });
    }
    return paths;
  },
});
```

**Example:** velocity field `(dx, dy) = (-y, x)` (rotation) with a 5×5 seed grid → 25 spiraling streamlines.

**Acceptance:**
- 4+ tests
- Reuses the trajectory's RK4 (extract to a shared helper `packages/core/src/math/rk4.ts`)
- Snapshot locks bytes; visual = recognizable flow field

**Effort:** M (~4 days).

PR title: `feat(math): mark: "streamline" — flow integration through vector fields (track A3/6)`.

---

## Task A4: Interactive sliders via `@glyph/live`

**Branch:** `feat/track-a4-sliders`

**Goal:** Let users (or agent-generated UIs) drop a slider that controls an animation parameter, with the chart re-rendering on each change. Static-SVG specs stay deterministic; the slider lives in `@glyph/live`.

**Files:**
- Create: `packages/live/src/slider.ts`
- Create: `packages/live/src/slider.test.ts`
- Modify: `packages/live/src/index.ts` — export `attachSlider`
- Modify: `packages/core/src/spec/schemas.ts` — add `interactive.sliders?: SliderSchema[]` (declarative slider metadata in the spec; the static renderer ignores it, the live package reads it)

**Implementation core:**

```ts
// packages/live/src/slider.ts
export interface SliderConfig {
  field: string;          // variable name the slider drives (e.g. "k")
  min: number;
  max: number;
  step: number;
  value: number;          // initial
}

export function attachSlider(
  container: HTMLElement,
  config: SliderConfig,
  onChange: (value: number) => void,
): void {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(config.min);
  input.max = String(config.max);
  input.step = String(config.step);
  input.value = String(config.value);
  input.addEventListener("input", () => onChange(Number(input.value)));
  container.appendChild(input);
  // ... +label, +value-readout, +CSS class hooks
}

export function bootSlidersFromSpec(
  rootElement: HTMLElement,
  spec: GlyphSpec,
  rerenderFn: (overrides: Record<string, number>) => void,
): void {
  // Reads spec.interactive.sliders, attaches one per entry, debounces rerenderFn.
}
```

**Example use (in a browser):**

```html
<div id="chart"></div>
<div id="controls"></div>
<script type="module">
  import { bootSlidersFromSpec } from "/glyph-live.js";

  const spec = await fetch("/play/examples/parametric-circle.json").then(r => r.json());
  // spec.interactive.sliders: [{ field: "k", min: 1, max: 5, step: 0.1, value: 2 }]
  bootSlidersFromSpec(
    document.getElementById("controls"),
    spec,
    (overrides) => rerenderInto("#chart", spec, overrides),
  );
</script>
```

**Determinism note:** the slider is browser-only. The static-SVG renderer ignores `interactive.sliders`. Snapshot tests of any spec that *only* uses sliders for animation will still be byte-stable (they render the initial state).

**Acceptance:**
- 3+ tests in `@glyph/live`
- Playground (S3 path) integrates sliders for a "parametric Lissajous" demo
- `interactive.sliders` schema field documented in `docs/MATH.md`

**Effort:** M (~5 days).

PR title: `feat(live): interactive sliders for live re-render (track A4/6)`.

---

## Task A5: Bezier construction visualizer

**Branch:** `feat/track-a5-bezier-construction`

**Goal:** Renders a Bezier curve with its control points, and (under `animation.kind: "draw-in"` or `"scrub"`) visualizes de Casteljau's algorithm — the construction lines that produce each point of the curve.

**Files:**
- Create: `packages/core/src/compiler/marks/bezier.ts`
- Create: `packages/core/src/compiler/marks/bezier.test.ts`
- Modify: `packages/core/src/spec/schemas.ts`
- Create: `packages/core/__fixtures__/math/bezier-cubic.json` + snapshot

**Implementation:**

```ts
registerMark({
  type: "bezier",
  compile(args) {
    // Spec:
    // { mark: "bezier",
    //   controlPoints: [{x, y}, ...],  // 3+ points (degree = N-1)
    //   showControls: true,
    //   showConstruction: false,        // true → de Casteljau lines
    //   samples: 100 }
    const points = layer.controlPoints;
    const curve = sampleBezier(points, layer.samples);
    const marks: SceneMark[] = [
      { type: "path", d: polylineToSvgD(curve), stroke: "#4c78a8", strokeWidth: 2, fill: "none" },
    ];
    if (layer.showControls) {
      // Dashed line between consecutive control points
      // Circles at each control point
    }
    if (layer.showConstruction && layer.t !== undefined) {
      // De Casteljau intermediate lines at parameter t
    }
    return marks;
  },
});
```

**Acceptance:**
- Bezier sampling deterministic (pure de Casteljau)
- `showConstruction: true` + `scrub` animation = animated construction
- 3+ tests + fixture

**Effort:** S (~2 days).

PR title: `feat(math): mark: "bezier" — cubic/quartic/N-degree with de Casteljau viz (track A5/6)`.

---

## Task A6: Chalkboard theme

**Branch:** `feat/track-a6-chalkboard-theme`

**Goal:** Visual identity matching 3Blue1Brown / Manim chalkboard aesthetic. Off-white-on-dark palette, hand-drawn stroke style.

**Files:**
- Create: `packages/core/src/themes/chalkboard.ts`
- Create: `packages/core/src/themes/chalkboard.test.ts`
- Modify: `packages/core/src/themes/index.ts` (register)
- Create: `packages/core/__fixtures__/math/chalkboard-decay.json` + snapshot

**Implementation:**

```ts
// packages/core/src/themes/chalkboard.ts
import { defineTheme } from "../themes/index.js";

defineTheme({
  name: "chalkboard",
  background: "#262626",
  foreground: "#f4f1de",
  palette: ["#fbcb88", "#e08a8e", "#8fc8b8", "#a4c2e7", "#f4f1de", "#f8b5b3"],
  fonts: {
    sans: '"Caveat", "Patrick Hand", sans-serif',
    mono: '"Cascadia Code", "Source Code Pro", monospace',
  },
  marks: {
    line: {
      strokeWidth: 2.2,
      // Apply a wobble: per-segment seeded jitter (mulberry32) on stroke-dashoffset
      filter: "url(#chalkboard-wobble)",
    },
    point: {
      strokeWidth: 1.4,
    },
  },
  // The defs the renderer emits at the top of the SVG when this theme is active.
  defs: `
    <filter id="chalkboard-wobble">
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="42"/>
      <feDisplacementMap in="SourceGraphic" scale="1.5"/>
    </filter>
  `,
});
```

**Determinism note:** `<feTurbulence seed="42">` is deterministic in SVG (the spec mandates a deterministic PRNG given the seed). Snapshot tests pass.

**Acceptance:**
- `spec.theme: "chalkboard"` renders byte-stably
- Decay-envelope demo fixture (looks like 3b1b)
- Updated `docs/THEMES.md` (or section in MATH.md)

**Effort:** S (~2 days).

PR title: `feat(theme): chalkboard — 3Blue1Brown aesthetic for math viz (track A6/6)`.

---

## Acceptance criteria for Track A overall

- [ ] All 6 PRs merged
- [ ] 6+ math fixtures with snapshot tests (damped-oscillator, predator-prey, pen-draw-fourier, velocity-field-streamlines, bezier-cubic, chalkboard-decay)
- [ ] No new MCP verbs added
- [ ] No new required runtime deps for `@glyph/core` (simplex-noise OK if needed for chalkboard, but only if SVG `feTurbulence` is insufficient)
- [ ] Each PR ships with a `docs/MATH.md` addendum
- [ ] Site `#examples` gains 6 cards highlighting each
- [ ] `awesome-interactive-math` parity scorecard updated in `docs/MATH-3D-EVALUATION.md`

---

## Self-review

**Spec coverage:**
- ✅ ODE solver → A1 (trajectory shape with RK4)
- ✅ Pen-draw animation → A2 (new `draw-in` kind)
- ✅ Streamlines → A3 (mark via registry; reuses RK4)
- ✅ Interactive sliders → A4 (`@glyph/live` extension)
- ✅ Bezier construction → A5 (mark via registry)
- ✅ Chalkboard theme → A6 (theme system)

**No placeholders:** every PR has files, code skeleton, fixture name, acceptance criteria, effort estimate.

**Independent PRs:** each PR could theoretically merge in any order. Dependencies are minimal: A3 reuses A1's RK4 helper (extract to shared `math/rk4.ts` in A1, consume in A3); A2 + A5 compose nicely but neither blocks the other.

**Foundation principles inherited from Phase 1:**
- ✅ Zero new MCP verbs (PR A4 adds a schema field; agents read it directly via `glyph_render`'s spec passthrough)
- ✅ Determinism (chalkboard's seeded turbulence; A1/A3's pure-fn RK4; A5's pure de Casteljau)
- ✅ Reuse existing animation primitives (A2 extends, doesn't replace)
- ✅ Mark/coordinate registries from Math PR3/PR5 absorb new entries cleanly
