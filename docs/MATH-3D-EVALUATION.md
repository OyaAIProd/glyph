# Math + 3D Evaluation — what Phase 1 covers, what it doesn't, and whether to plug in Three.js

> Written 2026-05-20, after Math PR1 merged and validated. Re-evaluate after the full math sub-plan (PR1–PR6) lands.

## Scope of this doc

Two questions, evaluated against the **Math phase-1** target (the 6-PR sub-plan in `docs/superpowers/plans/2026-05-20-math-extensions.md`, of which PR1 is already on `main`):

1. Can Glyph render the kinds of math/physics visualizations shown in 3Blue1Brown-style videos (e.g. the epicycloid spirograph at `youtu.be/zTeEljeithE`) and the projects listed in [`ubavic/awesome-interactive-math`](https://github.com/ubavic/awesome-interactive-math)?
2. If we want richer 3D / physics / engineering visualizations, should Glyph build its own 3D renderer or plug into Three.js?

The TL;DR is at the bottom.

---

## 1. The specific videos

### 1.1 `youtu.be/zTeEljeithE` — epicycloid spirograph (small circle rolling on a large one)

Mathematically:

```
x(t) = (R + r) · cos(t) − r · cos((R+r)/r · t)
y(t) = (R + r) · sin(t) − r · sin((R+r)/r · t)
```

This is a parametric curve. **Math PR2** ships exactly this shape (`data.shape: "function"` + `parameter: {name: "t", min: 0, max: 2π, samples: N}` + `xExpr` / `yExpr`). The animation of "the curve being traced over time, with the small circle's current position highlighted" decomposes to:

- One `line` mark over the full parametric data → the traced curve
- One `point` mark with `animation.kind: "scrub"` and `frame_field: "t"` → the moving small-circle position
- One `arc` mark drawing the small circle at the current `t` (its center + radius are also expressible as `(R+r)·cos(t), (R+r)·sin(t)` + the rolling angle)

**Verdict: yes, Math phase 1 (specifically PR2) renders this video.** The 3Blue1Brown polish (smooth easing, fade-ins, text labels at key moments) is partially covered by `stage-stagger` + the math-text mark from PR4; the rest is out of scope (see §3.3).

### 1.2 The full 3Blue1Brown style (chalkboard-look, sequenced scenes, transforming objects)

Manim — 3Blue1Brown's own library — is **imperative scene composition**:

```python
class MyScene(Scene):
    def construct(self):
        axes = Axes(...)
        self.play(Create(axes))
        graph = axes.plot(lambda x: x**2)
        self.play(Create(graph))
        self.play(Transform(graph, axes.plot(lambda x: x**3)))
        self.wait(2)
        ...
```

That's the opposite of Glyph's declarative grammar. The math sub-plan (`docs/superpowers/plans/2026-05-20-math-extensions.md`, "What's a poor fit") was explicit: **don't try to be Manim**.

Phase 1 can do many *individual* Manim moments (parametric curves, vector fields, equation labels, morph between two states) but not the *sequence* of them with `play().wait().play()` semantics.

---

## 2. `awesome-interactive-math` landscape

Based on the curated list, here's how Glyph after Math phase 1 fares against each category:

| Category | Examples | Math Phase 1 fit | Gap |
|---|---|---|---|
| **Function plotters** (Desmos-like) | Mafs, Grafar, JSXGraph | ✅ Full coverage via `data.shape: "function"` + parametric | Interactivity (sliders) lives in `@glyph/live`; not in core |
| **Articles with embedded interactives** | Bartosz Ciechanowski's posts | ⚠️ Partial — can render the static states; interactivity TBD | Interactive parameter scrubbing |
| **Educational books** (Trefethen, 3b1b) | Animated linear algebra demos | ⚠️ Partial — declarative animation covers transforms; sequenced scenes don't fit | Scene timeline composition |
| **Math games** (Euclidea, HyperRogue) | Geometry puzzles | ❌ Not a fit — games need imperative game loops + real-time input | Out of scope, intentionally |
| **3D viz** | MathBox (Three.js-based), Hyperbolica | ❌ Glyph is 2D-only today | This is the §4 question |
| **Fourier / complex viz** | Quaternion explorers, Riemann surface | ⚠️ Partial — 2D slices yes (with complex coords from PR5); full 4D quaternion no | 3D + interactivity |
| **Geometry construction** | Geogebra, Euclid JS | ⚠️ Partial — render the construction yes; live-edit no | Constructive primitives (intersect, bisect) |
| **Physics simulation** | Pendulum + spring demos | ⚠️ Partial — pre-computed trajectories animate; live simulation no | ODE solver + interactivity |

Most-glaring gap from the awesome list: **none of the listed projects are "agent-native, deterministic, MCP-callable"**. That's Glyph's lane. The list doesn't have a competitor for "an LLM generates a JSON spec → byte-stable SVG of the Riemann zeta function critical strip."

Second-glaring gap: **no Manim-equivalent declarative animation framework** is listed (Manim itself is imperative and isn't in this curation). There's room for a declarative math-animation language Glyph could fill — but only if it stays inside the grammar of graphics, not by adopting Manim's `play().wait()` model.

---

## 3. Gaps after Math phase 1

Categorized by "fixable in phase 2" vs "structural mismatch."

### 3.1 Tactical gaps — fixable in phase 2 (small to medium PRs)

| Gap | Effort | Fix |
|---|---|---|
| **ODE solvers (Runge-Kutta)** | M (1 PR) | New `data.shape: "trajectory"` that runs RK4 with `dx/dt`, `dy/dt` expressions over a time range. Compiles to rows. |
| **Pen-draw animation** (Manim's `Create(line)`) | M (1 PR) | New `animation.kind: "draw-in"` that emits SMIL `<animate attributeName="stroke-dashoffset">` from path-length → 0. Works with existing `line` / `path` marks. |
| **Numeric integration / shaded areas** | S (already partial) | Math PR4's `integral-area.json` fixture covers the visual; a `data.shape: "integral"` would let the agent ask "shade under f(x) from a to b." |
| **Streamlines** (vector-field flow paths) | M (1 PR) | Add to math PR3's vector-field mark. RK4 integration along the flow. |
| **Implicit plots (`f(x, y) = 0`)** | S | Reuse `mark: "contour"` with `threshold: 0`. |
| **Hand-drawn / chalkboard theme** | S | New `theme: "chalkboard"` in the existing theme system. Matches 3b1b aesthetic. |
| **Bezier construction visualizer** | S (1 PR) | New `mark: "bezier"` with control-point handles + an animatable parameter for the construction order. |
| **Interactive sliders** | M (extend `@glyph/live`) | The `linked-views` mechanism already exists. Add a `mark: "slider"` that publishes its value to a link group; specs subscribe. |

### 3.2 Architectural gaps — phase 3+ commitments

| Gap | Why it's hard | Possible approach |
|---|---|---|
| **3D rendering** | Scene graph is 2D-only | §4 — Three.js plugin |
| **Real-time interactivity** | Static SVG vs reactive frame loop | Already partially done by `@glyph/live`; extending to scrub-driven re-render against an in-browser compiler is doable |
| **Non-Euclidean geometries** (hyperbolic, spherical) | New coordinate types beyond Cartesian/polar/log/complex | Coordinate registry from math PR5 makes adding `coordinates: {type: "hyperbolic"}` straightforward; needs a tile generator |
| **Particle systems > 10k entities** | SVG can't paint that many marks at 60fps | `@glyph/canvas` already handles 10k+; WebGL via Three.js handles 1M+ |
| **3D camera + lighting** | No camera primitive | Phase 2b — full Three.js renderer |

### 3.3 Structural mismatches — Glyph deliberately doesn't do these

| Out-of-scope | Why | What to use instead |
|---|---|---|
| **Manim-style imperative scene composition** | Glyph is declarative; mixing paradigms would split the identity | Manim itself |
| **Computer algebra (symbolic differentiation, equation solving)** | Glyph is a renderer, not an algebra engine | SymPy / Mathematica via MCP (the agent can chain them) |
| **Voice-over sync / video timeline** | Out of rendering scope | Manim or a dedicated editor |
| **Game-loop interactivity** (60fps input → state → render) | Static spec → static output is the contract | Three.js / p5.js direct |
| **Sandboxed user code** (run arbitrary JS) | Determinism + security trade-off too steep | Plain D3 / Observable |

---

## 4. The Three.js plugin question

**Recommendation: yes, viable. Do it as a separate package after Phase 1 lands, in two sub-phases.**

### 4.1 Why Three.js (vs custom WebGL)

The awesome list confirms Three.js is the de-facto substrate for serious 3D math viz: **MathBox is built on it**, the books category leans heavily on it, several of the games use it. Building our own 3D engine when Three.js exists would be 6 months of work that doesn't compound.

Three.js gives us:

- A mature scene graph (`Scene` / `Mesh` / `Camera` / `Light`)
- A renderer that handles WebGL state, occlusion, depth, shading
- Geometry primitives (sphere, box, plane, parametric surface, line, point cloud)
- An animation system (`AnimationMixer`, `KeyframeTrack`)
- A material system (basic, lambert, phong, physical) — opt-in shading
- A maintained orbit / fly camera + raycaster for interactivity
- An MIT license, no commercial gates

The cost: ~600 KB minified gzipped. Acceptable for a 3D-viz package; the existing `@glyph/core` is 314 KB and ships everywhere, so we keep Three.js in a separate optional package (`@glyph/three`).

### 4.2 Architecture — how the plugin fits

Glyph's pipeline today:

```
Spec (JSON) → Compiler (pure) → Scene Graph (2D IR) → SVG renderer
                                                   ↓
                                                   Canvas renderer (@glyph/canvas)
```

Adding Three.js becomes:

```
Spec (JSON) → Compiler (pure) → Scene Graph 2D → SVG / Canvas
                              ↘
                                Scene Graph 3D → Three.js renderer (@glyph/three)
                                              ↘
                                                Three.js → headless WebGL → PNG (server)
                                                Three.js → live canvas (browser)
```

Concretely:

- **New scene-graph subtype `Scene3D`** alongside the existing `Scene`. Adds: `marks3D` (sphere, mesh, point-cloud, surface, line-3d, vector-arrow-3d, parametric-surface), `camera` (position, target, up, fov), `lights` (ambient, directional, point — all optional), `axes3D`.
- **Compiler dispatches on `spec.coordinates.type`.** `cartesian-3d`, `cylindrical`, `spherical`, `isometric-2d` all produce `Scene3D`. Cartesian / polar / log / complex stay 2D.
- **New mark types** for 3D-specific primitives. Existing 2D marks (`line`, `point`, `text`) work in 3D when the spec uses 3D coordinates — they just gain a `z` channel.
- **Camera object in the spec:**

  ```json
  {
    "camera": {
      "type": "perspective",
      "position": [3, 3, 3],
      "target": [0, 0, 0],
      "up": [0, 1, 0],
      "fov": 50
    }
  }
  ```

- **Animation extends to camera moves.** New `animation.kind: "orbit"` or `"fly-through"` interpolates the camera over time. SMIL doesn't help here — Three.js's own animation system handles it, and the renderer emits frames.
- **Determinism via headless rendering.** For server-side / agent use, the Three.js renderer rasterizes through `headless-gl` (or `gl` npm package) → produces a deterministic PNG byte-stream per frame. Snapshot tests stay byte-stable for the same input on the same hardware + driver. For client-side use, accept "visual equivalence" not "byte identity" — Three.js's output varies across GPUs.

### 4.3 Sub-phases

**Phase 2a — projected 3D in the existing 2D renderer** (~3-4 PRs, no Three.js dep)

Before committing to Three.js, validate that 3D is wanted:

- New `coordinates: {type: "isometric"}` / `"perspective"` / `"orthographic"` projects 3D points → 2D in the compiler. Existing 2D renderer + line / point / area marks paint the result.
- No occlusion, no lighting, no depth — but you can render a parametric surface in axonometric projection, a 3D vector field, a Lorenz attractor, a hypercube unfolding.
- 80% of "looks 3D enough" math viz at 5% of the engineering cost.
- If users love it, ship phase 2b. If not, stop here.

Concrete first PR:

```json
{
  "data": {
    "function": {
      "shape": "function",
      "parameter": { "name": "t", "min": 0, "max": 30, "samples": 3000 },
      "xExpr": "10*sin(t) + cos(2*t)",
      "yExpr": "10*cos(t) + sin(2*t)",
      "zExpr": "t / 3"
    }
  },
  "coordinates": { "type": "isometric", "yaw": 30, "pitch": 25 },
  "layers": [{ "mark": "line", "encoding": { "x": "x", "y": "y", "z": "z" } }]
}
```

The compiler reads `zExpr` → samples it → projects (x, y, z) → (x_screen, y_screen) via the isometric transform → existing line mark paints the polyline. **Math PR1 already reserved `zExpr?: string` in `FunctionDataSchema` exactly for this**.

**Phase 2b — `@glyph/three` package** (~8-12 PRs)

Only if phase 2a validates demand. New package, new MCP verb (`glyph_render_3d`) or a `renderer: "three"` flag on `glyph_render`. Headless rasterization for the agent-native path.

| PR | Scope |
|---|---|
| 2b.1 | `@glyph/three` package scaffold, Scene3D IR, headless renderer (gl npm) → PNG |
| 2b.2 | Mesh + sphere + box primitives. Maps `mark: "sphere"` / `"box"` to Three.js |
| 2b.3 | Parametric surfaces (`z = f(x, y)`); maps `mark: "surface"` |
| 2b.4 | Vector fields in 3D + glyph_anomaly overlay |
| 2b.5 | Camera animation (`animation.kind: "orbit"`) |
| 2b.6 | Optional lighting + materials (declarative spec fields) |
| 2b.7 | Browser-side live renderer + `@glyph/live` integration |
| 2b.8 | Streamlines via RK4 in 3D |
| 2b.9 | TopoJSON globe (use Phase 2b instead of the 2D `equalEarth` from PR40) |
| 2b.10 | Site showcase + docs |

### 4.4 What stays in the grammar after Three.js plugs in

The grammar of graphics doesn't change. The spec language gains:

- `coordinates.type ∈ ["cartesian-3d", "cylindrical", "spherical", "isometric", "perspective", "orthographic"]`
- A `camera` object when 3D coords are used
- Optional `lights` array
- New mark types — but they're still bound to data via encodings, same as today
- Existing data shapes (function, hierarchy, graph, grid, tabular) all work; they just optionally carry a `z` channel

**Crucially: no new MCP verbs.** An agent that knows `glyph_render` today renders 3D in phase 2b by setting `coordinates.type: "cartesian-3d"` — same MCP call.

### 4.5 What three.js gives us that pure math doesn't

A list of "now suddenly possible" visualizations, all of which are in `awesome-interactive-math`:

- **Sphere eversion / Klein bottle / torus knots** — parametric surfaces
- **Lorenz attractor in true 3D** with orbit camera
- **Hyperbolic geometry tilings** (Poincaré disk, half-plane, Beltrami-Klein) via custom coordinate types
- **Riemann surfaces** for complex functions
- **Quantum wavefunction visualization** (`|ψ|²` as volumetric)
- **Electromagnetic fields** with vector-arrow-3d at sampled grid points
- **Engineering**: finite-element mesh visualization, stress fields on a part
- **Physics**: orbital mechanics with N-body trajectories
- **Crystal lattices, molecular structures** (point clouds + bonds)
- **Topological surfaces** with normal-aware shading

The agent-native angle: an LLM that can write `{coordinates: "cartesian-3d", layers: [{mark: "parametric-surface", ...}]}` deterministically generates these. Nothing in the awesome list ships that capability.

### 4.6 What's hard even with Three.js

- **Real-time interactive sliders during agent use** — the agent sets parameters once, the renderer emits a PNG. Live interactivity is a separate thing (`@glyph/live` browser-side).
- **Byte-identical output across GPUs** — fundamentally not achievable; WebGL drivers differ. Snapshot tests use the headless `gl` package which IS deterministic on identical driver versions; for cross-platform CI we use a Docker image that pins the GL driver. PR2b.10 documents this.
- **Manim-style chalkboard polish** — Three.js can do toon-shading + 2D outline, but the visual identity is a theme decision, not a renderer one.
- **Voice-over sync** — out of scope. The renderer emits frame-N PNGs; a downstream tool (ffmpeg + voice file) syncs them.

---

## 5. Closing the gaps — concrete next-step plan after Math Phase 1

I'd execute these as **two parallel tracks** once Math PR2-6 land:

### Track A — Math Phase 2 (tactical extensions, ~6 PRs, stays inside Glyph proper)

| PR | What | Effort |
|---|---|---|
| A1 | `data.shape: "trajectory"` (RK4 ODE solver) | M |
| A2 | `animation.kind: "draw-in"` (Manim's Create) | S |
| A3 | Streamlines mark | M |
| A4 | Interactive sliders via `@glyph/live` + link-groups | M |
| A5 | Bezier-construction mark | S |
| A6 | Chalkboard theme | S |

After this, Glyph handles ~70% of `awesome-interactive-math`'s 2D categories.

### Track B — Glyph 3D phase 2a (projected 3D in 2D renderer, ~3 PRs)

| PR | What | Effort |
|---|---|---|
| B1 | `coordinates: {type: "isometric"}` + `zExpr` in function shape | M |
| B2 | 3D vector-field mark (arrows in isometric projection) | M |
| B3 | Parametric surface mark (`z = f(x, y)` → wireframe in isometric) | M |

Validates 3D demand. If users want photorealistic shading, occlusion, real perspective camera moves, ship Phase 2b.

### Track C — `@glyph/three` (only if 2a validates, ~10 PRs)

Per §4.3 PR table. New package, headless renderer, full 3D primitives, camera animation.

### Sequencing recommendation

1. Finish Math Phase 1 (PR2–PR6) first. Lock the foundation.
2. Ship Track A in parallel with Track B (low coupling).
3. Ship a `examples/` gallery for both tracks before deciding Track C.
4. Track C if (a) the 2a gallery gets traction OR (b) a concrete agent use case demands real 3D (e.g. molecular-structure rendering, engineering CAD review, physics simulation animation).

---

## 6. TL;DR

1. **Math Phase 1 covers the epicycloid video** (PR2 — parametric curves + scrub animation). It covers most 2D function plot / vector field / equation-label scenarios from `awesome-interactive-math`.
2. **It deliberately doesn't cover Manim** — imperative scene composition is the opposite paradigm. Glyph + Manim are complementary, not competing.
3. **Tactical gaps after Phase 1 are real but small** — ODE solvers, pen-draw animation, streamlines, sliders, chalkboard theme. ~6 PRs total in Track A.
4. **3D is the big gap.** Glyph is 2D-only today.
5. **Plugging in Three.js is viable** — `@glyph/three` as a separate package, headless renderer for determinism, no spec-language disruption (just new `coordinates.type` values + a `camera` object). ~10 PRs.
6. **Do it in two steps:** projected 3D first (3 PRs, no Three.js dep) to validate demand; then `@glyph/three` (10 PRs) if it lands.
7. **The agent-native angle is the wedge.** Nothing in `awesome-interactive-math` ships an LLM-callable, deterministic, MCP-native 3D math renderer. That's the position to claim.

Re-read this doc after Math PR2-6 lands; the recommendation may shift based on what real users build with Phase 1.
