# RFC: four math-grammar extensions for Glyph

**Status:** Design — open for feedback. None of these have shipped.
**Filed against:** v0.2.0 main, post-`site/math/joy.html`.
**Motivation:** the Joy of Math wow page renders nine demos; six are
parametric curves Glyph can already author from English (proved by
the new `__fixtures__/math/butterfly.json` and
`__fixtures__/math/hypotrochoid-rosette.json`). The remaining three
demos — **curlicue** (iterative recurrence), **particle flow**
(field-driven advection), **waves + reaction-diffusion** (PDE
solvers) — and the **gravity lens** (relativistic geodesics) sit
outside Glyph's grammar. This RFC proposes how to bring each into
the spec.

---

## Why this RFC exists

The Joy of Math wow page closes with: *"each is a natural extension —
a `data.shape: "recurrence"`, a `mark: "particle-flow"`, a
`data.shape: "pde-solve"`."* That sentence is a promise that an AI
agent could one day author any of those visualizations from one
prompt. This RFC turns the promise into four concrete proposals,
ordered by implementation cost.

The bar each extension must clear:

1. **Determinism.** Same spec → same SVG bytes across Ubuntu / macOS
   / Windows. The current `Math.sin` libm-drift guard
   (`canonicalStringify` clamps to 14 sig figs) is the floor.
2. **Snapshot stability.** Every fixture that uses the new shape /
   mark gets a `.svg` snapshot locked at byte identity in CI.
3. **Schema-clean.** Add to `MarkSchema` / `DataShapeSchema` via the
   same Zod pattern existing shapes use; no new top-level surface.
4. **Agent-readable.** The Zod schema's JSDoc on each new field
   should be enough for an LLM to author the spec from English
   without reading source.

Anti-bar:

- **No new top-level dependencies.** Existing `expr-eval` is the
  expression evaluator; no swap-out.
- **No browser-only rendering paths.** The MCP server returns static
  SVG; that's the determinism story. Anything that requires WebGL
  or a JS runtime to display lives in `@glyph/live` separately and
  is *not* in scope here.
- **No 3D renderer dependency.** When 3D is required (gravity lens,
  curved spacetime), it composes with the planned `@glyph/three`
  package (Track C), not this RFC.

---

## Extension 1 — `data.shape: "recurrence"` (curlicue, IFS, logistic map)

### Spec shape

```jsonc
{
  "data": {
    "function": {
      "shape": "recurrence",
      "state": ["x", "y"],
      "initial": { "x": 0, "y": 0 },
      "step": {
        // Each expression names a state variable on the LHS.
        // `n` (step index), `t` (parameter) are free vars.
        "x": "x + cos(theta * n * n + t)",
        "y": "y + sin(theta * n * n + t)"
      },
      "params": { "theta": 1.5708, "t": 0 },
      "steps": 8000
    }
  },
  "layers": [{
    "mark": "line",
    "encoding": { "x": "x", "y": "y" }
  }]
}
```

### What it generates

8 001 rows, each with the (x, y) state at step n. The compiler runs
the step expressions iteratively from `initial` for `steps`
iterations. `params` is a const map of free variables that don't
change between steps (the recurrence's "structural" parameters).

The output table column names match the keys in `state`. Step index
`n` is exposed as a synthesized column too, so it can drive `color`
encoding for "color by walk order."

### Implementation cost: **S** (~3 days)

The mechanic is a tighter cousin of `data.shape: "trajectory"`. The
difference: trajectory is an ODE `dx/dt = f(x,y)` integrated with
RK4 over a `(min, max)` of `t`. Recurrence is a discrete map
`x_{n+1} = g(x_n, y_n, n)` walked for N integer steps. The
expression evaluator (`expr-eval`) handles arbitrary-arity
expressions today — no new evaluator work.

Files touched:

  - `packages/core/src/data/shapes/recurrence.ts` (new, ~120 lines)
  - `packages/core/src/spec/schemas.ts` (+~40 lines of Zod)
  - `packages/core/src/spec/types.ts` (TS re-export)
  - `packages/core/__fixtures__/math/curlicue-golden.{json,test,svg}`
    (new fixture — the golden-angle curlicue from joy.html)

### Risks

- **Determinism**: every step is an `expr-eval` call. `expr-eval`'s
  trig is JS `Math.sin/cos` → libm-drift. Already handled by
  `canonicalStringify` clamp.
- **Performance**: 8 000 steps × ~6 mul/add per step = 48 000 ops.
  Negligible.
- **Step count cap**: hard-cap at 200 000 in the schema to prevent
  a malicious spec from hanging the compiler.

### Demos this unlocks

- Curlicue (joy.html §3) — primary motivator
- Logistic map iteration `x_{n+1} = r·x_n·(1−x_n)` — bifurcation
  studies
- Iterated function systems (Barnsley fern, Sierpinski triangle)
  if we add weighted-random branch selection (separate followup)

### Verdict

**Ship first.** Lowest cost, highest unlock value, no architectural
disturbance.

---

## Extension 2 — `mark: "particle-flow"` (advection visualization)

### Spec shape

```jsonc
{
  "data": {
    "function": {
      "shape": "vector-field-2d",
      // ψ = stream function; v = curl(ψ) auto-derived.
      "psi": "sin(k*x + omega*t) * cos(k*y) + cos(k*x) * sin(k*y - omega*t)",
      "domain": { "x": [-1, 1], "y": [-1, 1] },
      "params": { "k": 6.28, "omega": 1.0, "t": 0 }
    }
  },
  "layers": [{
    "mark": "particle-flow",
    "seeds": { "kind": "grid", "rows": 30, "cols": 30 },
    "length": 0.15,         // fraction of domain
    "step": 0.01,           // RK4 step size
    "colorBy": "angle"      // hue = direction at end of trace
  }]
}
```

### What it generates

For each seed point: RK4-integrate the velocity field for `length /
step` steps. Emit each trajectory as one polyline with color =
HSL(angle, 80%, 65%).

### Implementation cost: **S–M** (~4–6 days)

This is mostly already implemented! `mark: "streamline"` ships in
v0.2.0 and does almost this exact thing. The differences:

1. `streamline` ships with `dxdt`/`dydt` as separate expressions.
   `particle-flow` adds `psi` (stream function) → compiler derives
   `v = (∂ψ/∂y, −∂ψ/∂x)` via symbolic differentiation. **OR** we
   skip symbolic diff and ask the spec author for `dxdt`/`dydt`
   directly. Cleaner for v1.

2. `streamline` colors all paths the same. `particle-flow` adds
   `colorBy: "angle" | "speed" | "step"`. Pure render-time
   addition.

3. `streamline` is laid out for full-length flow lines. `particle-
   flow` shortens (`length`) and densifies (`seeds.rows/cols`).
   Just config plumbing.

So strictly: **`mark: "particle-flow"` could be implemented as
`mark: "streamline"` with new options**, not as a new mark. That's
the recommended path — keeps the mark registry small.

Files touched:

  - `packages/core/src/compiler/marks/streamline.ts` (add `colorBy`
    + tighter `length`/`density` defaults — ~50 lines)
  - `packages/core/src/spec/schemas.ts` (extend StreamlineSchema)
  - `packages/core/__fixtures__/math/particle-flow-curl.{…}` (new
    fixture — static snapshot of the joy.html flow-field demo at
    t=0)

### Risks

- **Animation gap**: a static SVG can't show particles flowing in
  time. The static output is a *snapshot* of the flow field at one
  `t`. To get animation, either:
  - (a) Use SMIL `<animateMotion>` on a representative subset of
    particles (the same trick the traveler mark uses).
  - (b) Defer to `@glyph/live` for browser-side particle simulation.

  (a) is the determinism-respecting choice and would compose with
  the existing traveler infrastructure.

### Verdict

**Ship as a streamline extension, not a new mark.** Total
incremental work: small.

---

## Extension 3 — `data.shape: "pde-solve"` (waves, reaction-diffusion, heat)

### Spec shape

```jsonc
{
  "data": {
    "function": {
      "shape": "pde-solve",
      "kind": "wave",     // wave | heat | reaction-diffusion | gray-scott
      "domain": { "x": [-1, 1], "y": [-1, 1] },
      "grid": { "rows": 200, "cols": 200 },
      "initial": {
        // Initial condition. For waves: u(x,y,0) and ∂u/∂t(x,y,0).
        // Gaussian impulse at origin:
        "u":    "exp(-50*(x*x + y*y))",
        "udot": "0"
      },
      "params": { "c": 0.5, "gamma": 0.003 },
      "boundary": "clamp",  // clamp | periodic | absorbing
      "steps": 400,
      "emit": { "kind": "snapshot", "at_step": 400 }
      // alternative: { "kind": "frames", "every": 10 } → emit
      //               40 frames of N rows each, for animation
    }
  },
  "layers": [{
    "mark": "heatmap",
    "encoding": { "x": "x", "y": "y", "color": "u" }
  }]
}
```

### What it generates

For `emit.kind = "snapshot"`: a single grid of (x, y, u) rows
(rows × cols rows total). The PDE solver runs `steps` integration
steps with the given initial condition and `params`, then emits the
final-state field.

For `emit.kind = "frames"`: a long table with an extra `frame`
column, useful with the existing `animation.kind: "scrub"` to
play back the PDE solution as a movie.

### Implementation cost: **M–L** (~10–15 days)

Significant work because:

1. **PDE-kind dispatch**: each of `wave / heat / reaction-diffusion
   / gray-scott` has a different update formula. The compiler needs
   a per-kind solver. Reasonable scope: one file per kind in
   `src/data/shapes/pde/`, ~120 lines each.

2. **Grid → row materialization**: a 200×200 grid is 40 000 rows
   per snapshot. With `emit.kind: "frames"` and 40 frames, that's
   1.6 M rows. Memory-aware row stream rather than naive array.

3. **Snapshot stability**: floating-point determinism across
   platforms is the killer. PDE solvers accumulate `Math.sin/exp`
   error over thousands of steps. We probably need to:
   - Clamp to a fixed step count + step size (no adaptive).
   - Use a numerically stable explicit scheme (forward Euler for
     reaction-diffusion is fine; leapfrog for waves).
   - Round intermediate state to e.g. f32 precision (truncate to
     ~7 sig figs each step) to eliminate trailing-bit divergence.

4. **Performance**: 200×200 × 400 steps × ~8 ops/cell/step = 128 M
   ops. ~200 ms in JS. Acceptable for compile-time but slow for
   the playground.

5. **Schema growth**: ~150 lines of Zod for the four PDE kinds plus
   their per-kind `params`. Not invasive but adds surface.

Files touched:

  - `packages/core/src/data/shapes/pde/` (new directory; one file
    per kind + index)
  - `packages/core/src/spec/schemas.ts` (+~150 lines)
  - `packages/core/__fixtures__/math/wave-impulse.{…}`,
    `__fixtures__/math/rd-spots.{…}` (new fixtures)

### Risks

- **Determinism is the big one.** A simple Linux/macOS smoke test
  on a 200-step reaction-diffusion shows hash divergence after
  ~100 steps even after canonicalStringify clamping. Need to
  resolve before merging — possibly by quantizing field values
  to f32 mid-step.

- **Animation file size**: 40 frames of 40 000 rows = 1.6 M rows
  serialized to SVG (heatmap path geometry) blows up file size.
  Mitigation: emit a single SVG with a CSS keyframe animation
  swapping `data:` URLs, OR delegate to `@glyph/live`.

### Verdict

**Ship after recurrence + particle-flow.** It's the most
ambitious and the most likely to encounter determinism foot-guns.
Worth scoping to *just* `kind: "heat"` (simplest, single field,
linear) for v1, then layering reaction-diffusion + wave on top.

---

## Extension 4 — Geodesic integration / gravity lens

### Spec shape

```jsonc
{
  "data": {
    "function": {
      "shape": "geodesic",
      "metric": "schwarzschild",     // schwarzschild | kerr | flrw | custom
      "mass": 1.0,                   // in geometrized units (G=c=1)
      "seeds": [
        // Each seed = a photon's initial 4-position and direction
        { "x0": -5, "y0": 0.3, "vx0": 1, "vy0": 0 },
        { "x0": -5, "y0": 0.1, "vx0": 1, "vy0": 0 }
      ],
      "step": 0.05,
      "max_lambda": 12  // affine parameter cap
    }
  },
  "layers": [{
    "mark": "line",
    "encoding": { "x": "x", "y": "y", "color": "seed_id" }
  }]
}
```

### What it generates

For each seed: RK4-integrate the geodesic equation
`d²x^μ/dλ² + Γ^μ_νρ · (dx^ν/dλ)(dx^ρ/dλ) = 0` in the chosen metric
until `max_lambda` or until the photon falls into the event
horizon. Emit one polyline per seed in (x, y) world coordinates.

### Implementation cost: **M** (~8–10 days)

The math is well-established. Christoffel symbols for Schwarzschild
in (t, r, θ, φ) coords are textbook. RK4 over a coupled 4-ODE
system is already what `trajectory` does in 2D — extension to 4D
is bookkeeping, not new infrastructure.

Files touched:

  - `packages/core/src/data/shapes/geodesic/` (new directory; per-
    metric Christoffel + projection code)
  - `packages/core/src/spec/schemas.ts` (+~50 lines)
  - `packages/core/__fixtures__/math/gravity-lens.{…}` (new
    fixture — the joy.html gravity demo as a Glyph spec)

### Risks

- **Coordinate projection.** Schwarzschild is naturally in
  spherical coordinates. The user wants a 2D Cartesian visualization
  on screen. Need a documented coord-conversion step (probably
  a `project: "equatorial"` option that fixes θ = π/2 and maps
  (r, φ) → (x, y)).

- **Geodesic completeness.** Photons can fall into the event
  horizon — what does the renderer emit? Truncate the polyline at
  the photon sphere (r = 1.5·rs); document this in a comment.

- **Determinism over thousands of steps.** Same libm-drift concern
  as PDE solvers. Same f32-quantize-per-step fix should work.

### Demos this unlocks

- Gravity lens (joy.html §6) — the headline demo
- Photon orbits around a black hole (precession; light bending)
- FLRW cosmology animations (universe expansion) if we add a
  time-dependent metric

### Verdict

**Ship third, after recurrence + particle-flow.** Less risky than
PDE-solve (the math is ODE-only; we don't have the field-on-a-grid
problem). High wow factor — a Glyph spec that renders Einstein's
1915 paper.

---

## Roadmap (recommended ordering)

| Order | Extension | Cost | Demos unlocked |
|-------|-----------|------|----------------|
| 1 | `data.shape: "recurrence"` | S | Curlicue, logistic map, IFS |
| 2 | `mark: "streamline"` extensions (subsumes particle-flow) | S | Flow field, weather-style wind maps |
| 3 | `data.shape: "geodesic"` | M | Gravity lens, photon orbits |
| 4 | `data.shape: "pde-solve"` (start with `kind: "heat"`) | M–L | Wave ripples, reaction-diffusion |

Each ships as its own PR with its own fixture, snapshot, and 5+
tests. The wow page (`site/math/joy.html`) gets a caption update
on each ship saying *"this is now a Glyph spec — see fixture X."*

If we ship **(1) + (2)** alone, 7 of the 9 joy.html demos become
Glyph specs and we have credible proof of the "agent-driven viz
layer for math" story for v0.3. Tracking issue: TBD when this RFC
lands.

---

## Open questions

1. **Should `params` (in recurrence + PDE) be allowed to vary
   over time?** That would unlock slider-driven animations as
   first-class spec content. Likely yes, but as a follow-up — v1
   keeps params static.

2. **Do we ever generate animation directly from a PDE/recurrence
   step trace?** The natural composition is "emit one frame per N
   steps, use `animation.kind: "scrub"` to play back." But that
   blows up file size. Decide before PDE-solve lands.

3. **Should new shapes share an `expression evaluator` interface
   to make future swap-out easier?** Today every shape calls
   `expr-eval` directly. Tomorrow we might want symbolic diff
   (e.g. for `psi` → `v` in particle-flow). Factor the
   evaluator interface now; pluggable evaluators are an A1-style
   investment.

4. **Should the `streamline` extension for `colorBy` go in this
   round, or as a separate PR titled "streamline polish"?**
   Smaller PRs ship faster; recommend splitting.

---

## Decision required

Greenlight on:

- [ ] Order: recurrence → streamline extensions → geodesic → PDE.
- [ ] Scope cap: PDE-solve v1 ships ONLY `kind: "heat"`. Wave +
      reaction-diffusion follow.
- [ ] Determinism approach: f32 mid-step quantization for the
      ODE/PDE solvers if `canonicalStringify` alone isn't enough.

Once greenlit, each extension becomes its own implementation
plan with task breakdown + TDD steps, following the existing
`docs/superpowers/plans/` pattern.
