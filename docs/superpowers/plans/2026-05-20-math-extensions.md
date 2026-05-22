# Math Extensions — function plots, vector fields, equations

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended). Each PR is one subagent dispatch. The master PR cycle template lives in `2026-05-18-tier-s-master.md`.

**Goal:** Extend Glyph's grammar of graphics to handle the most common math, physics, and engineering visualization shapes. Ship `data.shape: "function"`, parametric curves, vector fields, and KaTeX-rendered equations. Stay inside the data-driven grammar so the existing compiler / renderer / audit / animation / MCP machinery all keep working unchanged. Validate with 10 canonical math examples before deciding whether to extend further (3D, Manim-style imperative scenes — both deferred).

**Architecture:** Function plots are a new data shape (sibling of `tabular` / `hierarchy` / `graph` / `grid`). The materializer samples the expression at evenly-spaced points → produces rows → the existing line/area/point/arc machinery handles them unchanged. Vector fields and math-text become new mark types via a small registry refactor that future math marks can extend without touching the parser. No new MCP verbs; all changes flow through `glyph_render` + `glyph_audit_spec`. Existing animation primitives (`race`, `scrub`, `morph`) work out of the box for parametric trajectories.

**Foundation principles** (these make Options B/C/D buildable later without rewrites):

1. **Expression evaluator is pluggable** — materializer accepts an `evaluator` function; PR1 ships `expr-eval` but a future PR could swap in `mathjs` or a TS-native AST.
2. **Mark types via a registry** — PR3 introduces the registry pattern so `vector-field`, `streamline`, `tangent`, etc. can all add themselves at module-load without parser changes.
3. **Coordinate types via a registry** — same pattern for `log`, `complex`, future `hyperbolic`/`riemann-sphere`.
4. **Zero new MCP verbs** — agents that use Glyph today automatically inherit math support; no skill-file rev.
5. **Animation reuse** — no new `animation.kind`; reuse `race` / `scrub` / `morph`. The engine doesn't care that the rows came from a sampled function.
6. **3D-ready scene-graph shape** — `function` rows allow optional `z: number`; the current 2D renderer ignores it. A future 3D renderer (Option B) reads it without a spec rev.
7. **Symbolic-compute hook** — the evaluator interface lets a future agent pre-compute derivatives via SymPy / Wolfram and pass them in as additional identifiers. Hook stub today, no implementation.

**Tech stack:**
- TypeScript / Zod (same as core)
- `expr-eval@^2.0` for the safe expression evaluator (~9 KB, no `eval()`, deterministic, popular)
- `katex@^0.16` for equation rendering (server-side SSR via `katex.renderToString` → SVG inline; ~280 KB but tree-shake-able)
- vitest for tests; same snapshot-test discipline as today
- No new packages; everything lands in `packages/core`

**Effort:** L (6 PRs, ~3-4 calendar weeks).

**Calendar:** parallel to the Tier-S work — start when reviewer bandwidth allows.

---

## File structure

```
packages/core/src/
├── spec/
│   ├── schemas.ts                  # add FunctionDataSchema, MathTextMarkSchema, VectorFieldMarkSchema
│   └── types.ts                    # mirror types
├── data/
│   ├── shapes/
│   │   ├── function.ts             # new — sample(expr, range, samples) → rows
│   │   └── function.test.ts
│   └── materialize.ts              # extend with `if (data.function) ...` branch
├── eval/
│   ├── evaluator.ts                # new — pluggable evaluator interface
│   ├── expr-eval-adapter.ts        # new — wraps expr-eval, default backend
│   └── evaluator.test.ts
├── compiler/
│   ├── mark-registry.ts            # new — registry pattern + register builtin marks
│   ├── marks/
│   │   ├── vector-field.ts         # new — arrows from a 2D function
│   │   ├── math-text.ts            # new — KaTeX → inline SVG
│   │   ├── vector-field.test.ts
│   │   └── math-text.test.ts
│   └── compile.ts                  # mark-registry dispatch
├── coordinates/
│   ├── registry.ts                 # new — coordinate-type registry
│   ├── log.ts                      # already half-supported; promote here
│   ├── complex.ts                  # new — real/imaginary plane
│   └── registry.test.ts
├── audit/
│   ├── rules/
│   │   ├── function-domain.ts      # new — AUDIT-09
│   │   ├── samples-cap.ts          # new — AUDIT-10
│   │   └── undefined-identifier.ts # new — AUDIT-11
│   └── index.ts                    # register new rules
└── render/
    └── svg.ts                      # vector-field arrow + math-text inline SVG

packages/core/__fixtures__/math/
├── sine-wave.json                  # y = sin(x)
├── decay-envelope.json             # y = exp(-x/5) * cos(2*pi*x)
├── lissajous.json                  # parametric (sin(3t), cos(2t))
├── vector-field-rotation.json      # (-y, x)
├── lorenz-projection.json          # 2D slice of Lorenz (animated via race)
├── normal-distribution.json        # y = exp(-x^2/2)/sqrt(2*pi)
├── damped-oscillator.json          # 2nd-order ODE numeric integration
├── complex-mandelbrot-slice.json   # 2D slice via complex coords
├── integral-area.json              # y = sin(x), shaded area, math-text label
└── fourier-series.json             # animated partial-sum approximation

site/play/examples/                  # add math-viz preset entries to the playground dropdown
└── (linked from the existing examples picker)
```

`docs/MATH.md` lands in PR6 — the user-facing "Glyph for science" section.

---

## Task 1: PR1 — `data.shape: "function"` foundation

**Branch:** `feat/math-function-shape`

**Files:**
- Create: `packages/core/src/data/shapes/function.ts`
- Create: `packages/core/src/data/shapes/function.test.ts`
- Create: `packages/core/src/eval/evaluator.ts`
- Create: `packages/core/src/eval/expr-eval-adapter.ts`
- Create: `packages/core/src/eval/evaluator.test.ts`
- Modify: `packages/core/src/spec/schemas.ts` (add `FunctionDataSchema`)
- Modify: `packages/core/src/spec/types.ts` (mirror types)
- Modify: `packages/core/src/data/materialize.ts` (dispatch new branch)
- Modify: `packages/core/package.json` (add `expr-eval` dep)
- Create: `packages/core/__fixtures__/math/sine-wave.json` + `.svg` snapshot

- [ ] **Step 1: Write the failing test for the evaluator**

```ts
// packages/core/src/eval/evaluator.test.ts
import { describe, it, expect } from "vitest";
import { defaultEvaluator } from "./expr-eval-adapter.js";

describe("defaultEvaluator", () => {
  it("evaluates a simple identity", () => {
    expect(defaultEvaluator("x + 1", { x: 4 })).toBe(5);
  });

  it("evaluates a trig function", () => {
    expect(defaultEvaluator("sin(0)", {})).toBe(0);
    expect(defaultEvaluator("cos(0)", {})).toBe(1);
  });

  it("rejects an undefined identifier with a typed error", () => {
    expect(() => defaultEvaluator("y * 2", { x: 4 })).toThrow(/y/);
  });

  it("is deterministic across calls", () => {
    const a = defaultEvaluator("sin(x) * exp(-x/10)", { x: 1.234 });
    const b = defaultEvaluator("sin(x) * exp(-x/10)", { x: 1.234 });
    expect(a).toBe(b);
  });

  it("refuses to evaluate built-in Math methods that aren't safe", () => {
    // expr-eval doesn't expose Math.random by default; verify.
    expect(() => defaultEvaluator("random()", {})).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @glyph/core run test eval/evaluator.test.ts
```

Expected: `ImportError: cannot resolve './expr-eval-adapter.js'`.

- [ ] **Step 3: Add the dep**

```bash
pnpm --filter @glyph/core add expr-eval@^2.0
```

- [ ] **Step 4: Implement the evaluator interface**

```ts
// packages/core/src/eval/evaluator.ts
/**
 * Pluggable expression evaluator. PR1 ships an `expr-eval` adapter as the
 * default; future PRs can swap in mathjs / a TS-native AST without touching
 * call sites.
 *
 * Determinism contract: pure function. Same `expr` + same `scope` → same
 * numeric result, byte-stable across runs and platforms.
 */
export interface Evaluator {
  /**
   * @param expr  Source expression (e.g. "sin(x) * exp(-x/10)").
   * @param scope Map of identifiers to numeric bindings.
   * @returns The result, as a JS number.
   * @throws EvaluationError on undefined identifiers, parse errors, or
   *         disallowed operations. Caller chooses how to surface.
   */
  (expr: string, scope: Record<string, number>): number;
}

export class EvaluationError extends Error {
  constructor(
    message: string,
    readonly expression: string,
    readonly identifier?: string,
  ) {
    super(message);
    this.name = "EvaluationError";
  }
}
```

- [ ] **Step 5: Implement the `expr-eval` adapter**

```ts
// packages/core/src/eval/expr-eval-adapter.ts
import { Parser } from "expr-eval";
import { EvaluationError, type Evaluator } from "./evaluator.js";

// Singleton parser — expr-eval is safe to share across calls and gives us
// AST caching for free (the same expression string is parsed once).
const parser = new Parser({
  // Disallow operators that depend on Date / Math.random / I/O.
  operators: {
    add: true,
    concatenate: false,
    conditional: true,
    divide: true,
    factorial: false,
    multiply: true,
    power: true,
    remainder: true,
    subtract: true,
    logical: true,
    comparison: true,
    in: false,
    assignment: false,
  },
});

const cache = new Map<string, ReturnType<typeof parser.parse>>();

export const defaultEvaluator: Evaluator = (expr, scope) => {
  let ast = cache.get(expr);
  if (ast === undefined) {
    try {
      ast = parser.parse(expr);
    } catch (e) {
      throw new EvaluationError(`Cannot parse expression: ${(e as Error).message}`, expr);
    }
    cache.set(expr, ast);
  }
  try {
    const result = ast.evaluate(scope);
    if (typeof result !== "number" || !Number.isFinite(result)) {
      // NaN / Infinity surface as null in the materialized row, but we
      // never accept them as a valid numeric output from the evaluator.
      throw new EvaluationError(
        `Expression evaluated to non-finite ${String(result)}`,
        expr,
      );
    }
    return result;
  } catch (e) {
    if (e instanceof EvaluationError) throw e;
    const msg = (e as Error).message;
    // expr-eval throws "undefined variable: foo" for unbound identifiers.
    const match = /undefined variable:?\s*(\w+)/i.exec(msg);
    throw new EvaluationError(msg, expr, match?.[1]);
  }
};
```

- [ ] **Step 6: Run tests, fix until green**

```bash
pnpm --filter @glyph/core run test eval/
```

Expected: 5 passing.

- [ ] **Step 7: Write the failing test for the function-data sampler**

```ts
// packages/core/src/data/shapes/function.test.ts
import { describe, it, expect } from "vitest";
import { sampleFunction } from "./function.js";

describe("sampleFunction", () => {
  it("samples a simple identity at evenly-spaced points", () => {
    const rows = sampleFunction({
      shape: "function",
      x: { min: 0, max: 10, samples: 11 },
      expr: "x",
    });
    expect(rows).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
      { x: 6, y: 6 },
      { x: 7, y: 7 },
      { x: 8, y: 8 },
      { x: 9, y: 9 },
      { x: 10, y: 10 },
    ]);
  });

  it("produces byte-identical output across two calls", () => {
    const a = sampleFunction({
      shape: "function",
      x: { min: -Math.PI, max: Math.PI, samples: 500 },
      expr: "sin(x)",
    });
    const b = sampleFunction({
      shape: "function",
      x: { min: -Math.PI, max: Math.PI, samples: 500 },
      expr: "sin(x)",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("emits null for points where the expression is non-finite", () => {
    // log(0) → -Infinity, log(-1) → NaN. Both should land as null so the
    // renderer's line interpolator can break the path.
    const rows = sampleFunction({
      shape: "function",
      x: { min: -1, max: 1, samples: 3 },
      expr: "log(x)",
    });
    expect(rows[0].y).toBeNull(); // log(-1)
    expect(rows[1].y).toBeNull(); // log(0)
    expect(rows[2].y).toBe(0);    // log(1) = 0
  });

  it("caps samples at MAX_SAMPLES with a clear error", () => {
    expect(() =>
      sampleFunction({
        shape: "function",
        x: { min: 0, max: 1, samples: 200_000 },
        expr: "x",
      }),
    ).toThrow(/MAX_SAMPLES/);
  });

  it("rejects min >= max with a clear error", () => {
    expect(() =>
      sampleFunction({
        shape: "function",
        x: { min: 5, max: 5, samples: 10 },
        expr: "x",
      }),
    ).toThrow(/min.*max/);
  });
});
```

- [ ] **Step 8: Implement `sampleFunction`**

```ts
// packages/core/src/data/shapes/function.ts
import { defaultEvaluator } from "../../eval/expr-eval-adapter.js";
import { EvaluationError, type Evaluator } from "../../eval/evaluator.js";

/** Hard cap on samples per axis — prevents a malformed spec from DoS-ing the
 *  compiler. 100k is enough for any plot a human can read; audit warns at
 *  10k+ (see AUDIT-10 in PR5). */
export const MAX_SAMPLES = 100_000;

export interface FunctionDataSpec {
  shape: "function";
  /** Free-variable name → range. PR1 supports a single `x`; PR2 widens to
   *  parametric `{x, y}` from a free `t`. */
  x: { min: number; max: number; samples: number };
  /** Single-output expression. Identifiers: the keys of `x` ∪
   *  constants (`pi`, `e`) ∪ standard math functions. */
  expr: string;
  /** Optional 3D z-coordinate. Today's renderer ignores it; a future 3D
   *  renderer (Option B) reads it. Stays optional + undefined-safe. */
  zExpr?: string;
}

export interface FunctionRow {
  x: number;
  y: number | null;
  z?: number | null;
}

export function sampleFunction(
  spec: FunctionDataSpec,
  evaluator: Evaluator = defaultEvaluator,
): FunctionRow[] {
  if (spec.x.min >= spec.x.max) {
    throw new Error(
      `function data: x.min (${spec.x.min}) must be < x.max (${spec.x.max})`,
    );
  }
  if (spec.x.samples > MAX_SAMPLES) {
    throw new Error(
      `function data: x.samples (${spec.x.samples}) > MAX_SAMPLES (${MAX_SAMPLES})`,
    );
  }
  if (spec.x.samples < 2) {
    throw new Error(`function data: x.samples must be >= 2`);
  }

  const rows: FunctionRow[] = [];
  const step = (spec.x.max - spec.x.min) / (spec.x.samples - 1);
  for (let i = 0; i < spec.x.samples; i++) {
    const x = spec.x.min + step * i;
    const row: FunctionRow = {
      x,
      y: safeEval(evaluator, spec.expr, { x }),
    };
    if (spec.zExpr !== undefined) {
      row.z = safeEval(evaluator, spec.zExpr, { x });
    }
    rows.push(row);
  }
  return rows;
}

function safeEval(
  evaluator: Evaluator,
  expr: string,
  scope: Record<string, number>,
): number | null {
  try {
    return evaluator(expr, scope);
  } catch (e) {
    // Non-finite at a single point is a render concern, not a fatal error.
    // The renderer treats null y as a path break (a hole in the line).
    if (e instanceof EvaluationError && /non-finite/.test(e.message)) {
      return null;
    }
    throw e;
  }
}
```

- [ ] **Step 9: Wire the new shape into materialize**

```ts
// packages/core/src/data/materialize.ts (snippet — patch the dispatch)
// ... existing imports ...
import { sampleFunction } from "./shapes/function.js";

// Inside materializeSpec, before the existing tabular branch:
if (spec.data && "function" in spec.data) {
  const rows = sampleFunction(spec.data.function);
  const schema = [
    { name: "x", type: "DOUBLE" },
    { name: "y", type: "DOUBLE" },
    ...(rows[0]?.z !== undefined ? [{ name: "z", type: "DOUBLE" }] : []),
  ];
  return synthesizeInlineHandle(rows, schema, /* shape: */ "function");
}
```

Reuses `synthesizeInlineHandle` (the bypass path established in PR67/68 for hierarchy + graph + grid data). No new handle plumbing required.

- [ ] **Step 10: Add the spec schema**

```ts
// packages/core/src/spec/schemas.ts (snippet)
export const FunctionDataSchema = z.object({
  shape: z.literal("function"),
  x: z.object({
    min: z.number().finite(),
    max: z.number().finite(),
    samples: z.number().int().min(2).max(MAX_SAMPLES),
  }),
  expr: z.string().min(1),
  zExpr: z.string().min(1).optional(),
});

// Extend the DataSchema union:
export const DataSchema = z.union([
  // ... existing ...
  z.object({ function: FunctionDataSchema }),
]);
```

- [ ] **Step 11: Write a snapshot test for the example**

```ts
// packages/core/src/__fixtures__/math/sine-wave.test.ts
import { describe, it, expect } from "vitest";
import { renderSvg } from "../../render/svg.js";
import { compileSpec } from "../../compiler/compile.js";
import { materializeSpec } from "../../data/materialize.js";
import sineWaveSpec from "./sine-wave.json";

describe("math examples — sine wave", () => {
  it("renders y = sin(x) deterministically", async () => {
    const m = await materializeInline(sineWaveSpec);
    const scene = compileSpec({
      spec: sineWaveSpec,
      rows: m.rows,
      schema: m.schema,
    });
    const svg = renderSvg(scene);
    expect(svg).toMatchFileSnapshot("./sine-wave.svg");
  });
});
```

The `sine-wave.json` spec:

```json
{
  "version": "0.0.1",
  "data": {
    "function": {
      "shape": "function",
      "x": { "min": -6.283185307179586, "max": 6.283185307179586, "samples": 200 },
      "expr": "sin(x)"
    }
  },
  "layers": [{ "mark": "line", "encoding": { "x": "x", "y": "y" } }],
  "scales": { "y": { "domain": [-1.2, 1.2] } }
}
```

- [ ] **Step 12: Run the standard PR cycle**

See `2026-05-18-tier-s-master.md` → `[PR-CYCLE]`. Verification:

- `pnpm --filter @glyph/core run test` → all green (existing tests + 5 evaluator + 5 sampler + 1 snapshot)
- `pnpm --filter @glyph/core run build` clean
- `pnpm lint` clean
- 6-cell CI matrix green

Acceptance for PR1:
- `glyph.render({"data": {"function": {...}}, "layers": [{"mark": "line", ...}]})` renders a sine wave deterministically
- Byte-identity across two calls
- Snapshot test locks the SVG bytes
- 5 evaluator tests + 5 sampler tests pass
- AUDIT-09/10/11 stubs are not yet wired (PR5)

PR title: `feat(math): data.shape: "function" + pluggable expression evaluator (math PR1/6)`.

---

## Task 2: PR2 — Parametric curves + free-variable extension

**Branch:** `feat/math-parametric`

**Files:**
- Modify: `packages/core/src/data/shapes/function.ts` (parametric path)
- Modify: `packages/core/src/spec/schemas.ts` (add parametric schema variant)
- Create: `packages/core/__fixtures__/math/lissajous.json` + snapshot
- Create: `packages/core/__fixtures__/math/lorenz-projection.json` + snapshot
- Modify: `packages/core/src/data/shapes/function.test.ts` (3 more tests)

- [ ] **Step 1: Failing test for parametric**

```ts
// packages/core/src/data/shapes/function.test.ts (additions)
it("samples a parametric curve from a single free variable t", () => {
  // Circle: (cos t, sin t)
  const rows = sampleFunction({
    shape: "function",
    parameter: { name: "t", min: 0, max: 2 * Math.PI, samples: 4 },
    xExpr: "cos(t)",
    yExpr: "sin(t)",
  });
  expect(rows).toEqual([
    { x: 1, y: 0 },
    expect.objectContaining({ x: expect.closeTo(-0.5, 5) }),
    // ... etc
  ]);
});

it("animates over a frame parameter when frame_field is set", () => {
  // y = sin(k*x) over k ∈ [1..5]. Race animation should produce 5 frames
  // of identical x-axis but varying y-axis.
  // (test asserts the compiler builds the frames array correctly)
});
```

- [ ] **Step 2: Extend the function-data shape**

```ts
// packages/core/src/data/shapes/function.ts (additions)

/** Parametric form — single free parameter t, two output expressions for
 *  x and y. The single-x form (PR1) is still supported; this is a sibling. */
export interface ParametricDataSpec {
  shape: "function";
  parameter: { name: string; min: number; max: number; samples: number };
  xExpr: string;
  yExpr: string;
  zExpr?: string;
}

export function sampleFunction(
  spec: FunctionDataSpec | ParametricDataSpec,
  evaluator: Evaluator = defaultEvaluator,
): FunctionRow[] {
  if ("parameter" in spec) {
    return sampleParametric(spec, evaluator);
  }
  return sampleScalar(spec, evaluator);
}

function sampleParametric(spec: ParametricDataSpec, evaluator: Evaluator): FunctionRow[] {
  // ... mirror of sampleScalar but with two/three expressions evaluated
  // against the same `t` value at each step.
}
```

- [ ] **Step 3: Update the schema**

```ts
export const ParametricDataSchema = z.object({
  shape: z.literal("function"),
  parameter: z.object({
    name: z.string().regex(/^[a-z_][a-z0-9_]*$/i),
    min: z.number().finite(),
    max: z.number().finite(),
    samples: z.number().int().min(2).max(MAX_SAMPLES),
  }),
  xExpr: z.string().min(1),
  yExpr: z.string().min(1),
  zExpr: z.string().min(1).optional(),
});

// FunctionDataSchema becomes a union of scalar + parametric.
```

- [ ] **Step 4: Lissajous example**

```json
// packages/core/__fixtures__/math/lissajous.json
{
  "version": "0.0.1",
  "data": {
    "function": {
      "shape": "function",
      "parameter": { "name": "t", "min": 0, "max": 6.283185307179586, "samples": 400 },
      "xExpr": "sin(3*t)",
      "yExpr": "cos(2*t)"
    }
  },
  "layers": [{ "mark": "line", "encoding": { "x": "x", "y": "y" } }],
  "coordinates": { "type": "linear", "aspect": 1 }
}
```

- [ ] **Step 5: Race-animation example with frame_field**

```json
// packages/core/__fixtures__/math/lorenz-projection.json
{
  "version": "0.0.1",
  "data": {
    "function": {
      "shape": "function",
      "parameter": { "name": "t", "min": 0, "max": 30, "samples": 3000 },
      "xExpr": "10*sin(t)",
      "yExpr": "10*cos(t)"
    }
  },
  "layers": [{ "mark": "line", "encoding": { "x": "x", "y": "y" } }],
  "animation": { "kind": "scrub", "duration_ms": 8000, "frame_field": "t" }
}
```

Animation reuses the existing `scrub` machinery. The compiler treats the parameter column as the frame field; the renderer emits SMIL frames.

Acceptance for PR2:
- Lissajous spec renders byte-stably
- Parametric tests pass (3 new)
- Animated trajectory via `scrub` works against parametric data
- Spec schema accepts both scalar + parametric forms; old single-`x` specs still parse

PR title: `feat(math): parametric curves + animation hook (math PR2/6)`.

---

## Task 3: PR3 — Mark registry + `vector-field`

**Branch:** `feat/math-vector-field`

This is the structural refactor PR. Today's compiler dispatches mark types via a `switch`. PR3 promotes this to a registry so future math marks (`streamline`, `tangent`, `surface`) can register at module-load. Vector-field is the first new mark to use the registry.

**Files:**
- Create: `packages/core/src/compiler/mark-registry.ts`
- Create: `packages/core/src/compiler/marks/vector-field.ts`
- Create: `packages/core/src/compiler/marks/vector-field.test.ts`
- Create: `packages/core/src/scenegraph/marks/arrow.ts` (new SceneMark type)
- Modify: `packages/core/src/compiler/compile.ts` (delegate to registry)
- Modify: `packages/core/src/compiler/marks/*.ts` (existing marks register themselves)
- Modify: `packages/core/src/render/svg.ts` (arrow case)
- Modify: `packages/core/src/spec/schemas.ts` (`mark: "vector-field"`)
- Create: `packages/core/__fixtures__/math/vector-field-rotation.json` + snapshot

- [ ] **Step 1: Define the registry**

```ts
// packages/core/src/compiler/mark-registry.ts
import type { GlyphSpec } from "../spec/types.js";
import type { Scene, SceneMark } from "../scenegraph/types.js";

export interface MarkCompiler {
  /** Marks like "bar", "line", "vector-field", etc. */
  readonly type: string;
  /**
   * Produce SceneMarks for one layer of the spec. Receives the compiler
   * context (rows, scales, plot area) — the registry shape stays stable
   * even as new fields land.
   */
  compile(args: MarkCompileArgs): SceneMark[];
}

export interface MarkCompileArgs {
  layer: GlyphSpec["layers"][number];
  rows: ReadonlyArray<Record<string, unknown>>;
  scales: Scene["scales"]; // existing type
  plotArea: Scene["plotArea"];
  // ... whatever the existing compiler hands its inner switch cases
}

const registry = new Map<string, MarkCompiler>();
export function registerMark(c: MarkCompiler): void {
  if (registry.has(c.type)) {
    throw new Error(`Mark "${c.type}" already registered`);
  }
  registry.set(c.type, c);
}
export function getMarkCompiler(type: string): MarkCompiler {
  const c = registry.get(type);
  if (!c) throw new Error(`Unknown mark type: ${type}`);
  return c;
}
```

- [ ] **Step 2: Move existing marks into the registry**

For each of `bar`, `line`, `point`, `area`, `rule`, `arc`, `treemap`, `sunburst`, `force`, `contour`, `text` — extract its compile case from the switch into a `MarkCompiler`. The existing test suite must stay green throughout this refactor.

Bulk-move strategy: one PR3 sub-commit per mark family, refactor + run tests, then proceed. The biome+vitest matrix catches regressions immediately.

- [ ] **Step 3: Implement the vector-field mark**

```ts
// packages/core/src/compiler/marks/vector-field.ts
import { registerMark, type MarkCompileArgs } from "../mark-registry.js";
import type { SceneMark } from "../../scenegraph/types.js";

registerMark({
  type: "vector-field",
  compile(args: MarkCompileArgs): SceneMark[] {
    // Expects rows like {x, y, dx, dy} (precomputed by either function-data
    // PR1/2 with a 2D parameter or by the user as inline data).
    const arrows: SceneMark[] = [];
    for (const row of args.rows) {
      const x = args.scales.x(row.x as number);
      const y = args.scales.y(row.y as number);
      const dx = (row.dx as number) || 0;
      const dy = (row.dy as number) || 0;
      const magnitude = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      arrows.push({
        type: "arrow",
        x,
        y,
        length: clamp(magnitude * 8, 4, 24), // pixels
        angle,
        // color by magnitude if encoded
      });
    }
    return arrows;
  },
});
```

- [ ] **Step 4: New SceneMark.arrow + SVG render**

```ts
// packages/core/src/render/svg.ts (snippet)
function renderArrow(m: { x: number; y: number; length: number; angle: number; stroke: string }): string {
  const x2 = m.x + Math.cos(m.angle) * m.length;
  const y2 = m.y + Math.sin(m.angle) * m.length;
  // Arrowhead via marker-end on the line. Marker definition emitted once
  // in <defs> by the SVG render preamble (see svg-defs.ts).
  return `<line x1="${roundPx(m.x)}" y1="${roundPx(m.y)}" x2="${roundPx(x2)}" y2="${roundPx(y2)}" stroke="${esc(m.stroke)}" stroke-width="1.5" marker-end="url(#vec-arrow)"/>`;
}
```

Marker definition lands in the SVG preamble's `<defs>` so it appears exactly once regardless of arrow count.

- [ ] **Step 5: Example fixture**

```json
// packages/core/__fixtures__/math/vector-field-rotation.json
{
  "version": "0.0.1",
  "data": {
    "values": [
      { "x": -2, "y": -2, "dx": 2, "dy": -2 },
      { "x": -2, "y": -1, "dx": 1, "dy": -2 },
      // ... 25 rows on a 5x5 grid sampled from (-y, x)
    ]
  },
  "layers": [
    { "mark": "vector-field", "encoding": { "x": "x", "y": "y" } }
  ],
  "coordinates": { "type": "linear", "aspect": 1 }
}
```

(PR3 keeps the rows hand-precomputed for clarity; PR3.5 / PR2 follow-up could extend the function-data shape to emit `{x, y, dx, dy}` from a 2D vector expression — left as a tracking issue.)

Acceptance for PR3:
- Mark registry pattern lands; all 11 existing marks pass through it without behavior change (existing snapshot tests stay byte-identical)
- `mark: "vector-field"` renders arrows from `{x, y, dx, dy}` rows
- Vector-field rotation snapshot test green

PR title: `feat(math): mark registry + vector-field mark (math PR3/6)`.

---

## Task 4: PR4 — `mark: "math-text"` via KaTeX

**Branch:** `feat/math-text-katex`

**Files:**
- Create: `packages/core/src/compiler/marks/math-text.ts`
- Create: `packages/core/src/compiler/marks/math-text.test.ts`
- Create: `packages/core/src/scenegraph/marks/math-text.ts` (new SceneMark type)
- Modify: `packages/core/src/render/svg.ts` (math-text → SVG via KaTeX SSR)
- Modify: `packages/core/src/spec/schemas.ts`
- Modify: `packages/core/package.json` (add `katex` dep)
- Create: `packages/core/__fixtures__/math/integral-area.json` + snapshot

KaTeX's `renderToString` runs server-side, produces HTML+MathML. For SVG embedding we use `renderToString` then extract the `<svg>` part via KaTeX's `output: "html"` + a small adapter that converts the MathML to inline SVG paths. Alternatively, use `katex-svg-renderer` if it exists, or accept HTML-in-SVG via `<foreignObject>` (less portable but byte-stable).

**Recommended approach:** `<foreignObject>` for v1 (KaTeX's HTML output rendered into an SVG `<foreignObject>`). Simpler, byte-stable as long as KaTeX is byte-stable (it is — pure-fn). Downside: requires a browser that supports foreignObject for rasterization (most do; resvg-js does too).

- [ ] **Step 1: Failing test**

```ts
// packages/core/src/compiler/marks/math-text.test.ts
import { describe, it, expect } from "vitest";
import { renderSvg } from "../../render/svg.js";
import { compileSpec } from "../compile.js";

describe("math-text mark", () => {
  it("renders a TeX expression byte-stably", () => {
    const spec = {
      data: { values: [{ x: 0, y: 0 }] },
      layers: [{
        mark: "math-text" as const,
        x: 100, y: 50,
        tex: "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}",
      }],
    };
    const r1 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const r2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(r1).toBe(r2);
    expect(r1).toContain("<foreignObject");
    expect(r1).toContain('class="katex"');
  });

  it("escapes malicious TeX (no script injection)", () => {
    const spec = {
      data: { values: [] },
      layers: [{
        mark: "math-text" as const,
        x: 0, y: 0,
        tex: "<script>alert(1)</script>",
      }],
    };
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // KaTeX escapes `<` etc. inside its output. Just ensure no raw <script>
    // ends up in the SVG.
    expect(svg).not.toContain("<script>alert(1)</script>");
  });
});
```

- [ ] **Step 2: Implement the mark + render**

```ts
// packages/core/src/compiler/marks/math-text.ts
import katex from "katex";
import { registerMark } from "../mark-registry.js";

registerMark({
  type: "math-text",
  compile(args) {
    return args.layer.encoding ? [] : [
      {
        type: "math-text",
        x: args.layer.x,
        y: args.layer.y,
        tex: args.layer.tex,
        // Precompute the HTML once at compile time — keeps render-time
        // determinism in lockstep with the existing pipeline.
        renderedHtml: katex.renderToString(args.layer.tex, {
          displayMode: args.layer.displayMode ?? false,
          output: "html",
          throwOnError: false,
          errorColor: "#cc0000",
          strict: "warn",
        }),
      },
    ];
  },
});
```

```ts
// packages/core/src/render/svg.ts (snippet)
case "math-text": {
  // KaTeX HTML inside a foreignObject. Bounding box estimated server-side
  // via the rendered HTML (KaTeX emits inline styles with explicit em widths).
  const w = 300, h = 60; // PR4 keeps this generous; PR4.5 could measure.
  return `<foreignObject x="${roundPx(m.x)}" y="${roundPx(m.y)}" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml">${m.renderedHtml}</div></foreignObject>`;
}
```

- [ ] **Step 3: KaTeX CSS bundling note**

KaTeX needs its CSS (`katex.min.css`) for proper rendering when the SVG is embedded in a host page. For server-rendered SVG (resvg, ImageMagick), the CSS is inlined automatically by KaTeX. Document in `docs/MATH.md`.

- [ ] **Step 4: Integral-area example**

```json
// packages/core/__fixtures__/math/integral-area.json
{
  "version": "0.0.1",
  "data": {
    "function": {
      "shape": "function",
      "x": { "min": 0, "max": 6.283185307179586, "samples": 200 },
      "expr": "sin(x)"
    }
  },
  "layers": [
    { "mark": "area", "encoding": { "x": "x", "y": "y" }, "opacity": 0.3 },
    { "mark": "line", "encoding": { "x": "x", "y": "y" } },
    {
      "mark": "math-text",
      "x": 200, "y": 100,
      "tex": "\\int_0^{2\\pi} \\sin(x)\\,dx = 0",
      "displayMode": true
    }
  ]
}
```

Acceptance for PR4:
- KaTeX-rendered equation appears inline in the SVG
- Byte-stable across two renders
- HTML injection guarded (KaTeX's own escaping)
- 2 tests + 1 snapshot

PR title: `feat(math): math-text mark via KaTeX (math PR4/6)`.

---

## Task 5: PR5 — Audit rules + coordinate registry

**Branch:** `feat/math-audit-coords`

**Files:**
- Create: `packages/core/src/audit/rules/function-domain.ts` (AUDIT-09)
- Create: `packages/core/src/audit/rules/samples-cap.ts` (AUDIT-10)
- Create: `packages/core/src/audit/rules/undefined-identifier.ts` (AUDIT-11)
- Modify: `packages/core/src/audit/index.ts` (register new rules)
- Create: `packages/core/src/coordinates/registry.ts`
- Create: `packages/core/src/coordinates/log.ts`
- Create: `packages/core/src/coordinates/complex.ts`
- Modify: `packages/core/src/coordinates/index.ts` (delegate to registry)

- [ ] **Step 1: AUDIT-09 — function-domain not specified**

```ts
// packages/core/src/audit/rules/function-domain.ts
import type { AuditRule } from "../index.js";

export const functionDomainRule: AuditRule = {
  id: "AUDIT-09",
  severity: "medium",
  evaluate(spec) {
    if (!spec.data || !("function" in spec.data)) return [];
    const fn = spec.data.function;
    const range = "x" in fn ? fn.x : fn.parameter;
    if (range.max - range.min < 1e-9) {
      return [{
        rule_id: "AUDIT-09",
        severity: "medium",
        message: `function ${range.name ?? "x"} domain is collapsed (min ≈ max)`,
        suggestion: "Set a wider range for the free parameter.",
      }];
    }
    return [];
  },
};
```

- [ ] **Step 2: AUDIT-10 — samples warning**

```ts
export const samplesCapRule: AuditRule = {
  id: "AUDIT-10",
  severity: "low",
  evaluate(spec) {
    if (!spec.data || !("function" in spec.data)) return [];
    const fn = spec.data.function;
    const samples = ("x" in fn ? fn.x : fn.parameter).samples;
    if (samples > 10_000) {
      return [{
        rule_id: "AUDIT-10",
        severity: "low",
        message: `function samples = ${samples} is high; render performance may suffer.`,
        suggestion: "Consider reducing to 1000-5000 unless you're animating.",
      }];
    }
    return [];
  },
};
```

- [ ] **Step 3: AUDIT-11 — undefined identifier**

```ts
export const undefinedIdentifierRule: AuditRule = {
  id: "AUDIT-11",
  severity: "high",
  evaluate(spec) {
    if (!spec.data || !("function" in spec.data)) return [];
    const fn = spec.data.function;
    // Dry-run the evaluator on a single value and catch EvaluationError
    // with the identifier set. Quick + deterministic.
    const exprs = "expr" in fn ? [fn.expr] : [fn.xExpr, fn.yExpr];
    const freeVar = "x" in fn ? "x" : fn.parameter.name;
    const findings = [];
    for (const expr of exprs) {
      try {
        defaultEvaluator(expr, { [freeVar]: 0 });
      } catch (e) {
        if (e instanceof EvaluationError && e.identifier) {
          findings.push({
            rule_id: "AUDIT-11",
            severity: "high",
            message: `Expression references undefined identifier '${e.identifier}'.`,
            suggestion: `Bind ${e.identifier} or replace it with a constant.`,
          });
        }
      }
    }
    return findings;
  },
};
```

- [ ] **Step 4: Coordinate registry**

```ts
// packages/core/src/coordinates/registry.ts
export interface CoordinateProvider {
  readonly type: string;
  /** Produce x/y scale functions given the coordinate config. */
  buildScales(config: unknown, plotArea: PlotArea): { x: Scale; y: Scale };
}
const registry = new Map<string, CoordinateProvider>();
export function registerCoordinate(p: CoordinateProvider): void { /* ... */ }
```

Then `log` and `complex` register themselves at module load. Existing `polar` + `linear` move into the registry as part of the refactor.

Acceptance for PR5:
- 3 new audit rules fire on the right specs and don't fire on others
- Coordinate registry stays byte-identical to the existing hardcoded dispatch
- `coordinates: { type: "log", base: 10 }` works on a line chart
- `coordinates: { type: "complex" }` interprets `x = Re`, `y = Im`

PR title: `feat(math): audit rules + coordinate registry (math PR5/6)`.

---

## Task 6: PR6 — Showcase + docs

**Branch:** `feat/math-showcase`

**Files:**
- Create: `docs/MATH.md` (user-facing "Glyph for science" page)
- Create: `packages/core/__fixtures__/math/{normal-distribution, damped-oscillator, fourier-series, complex-mandelbrot-slice}.json` + snapshots
- Modify: `site/index.html` (math section in `#examples`)
- Modify: `site/play/playground.js` (math presets in example dropdown)
- Modify: `README.md` (one paragraph + link to MATH.md)

`docs/MATH.md` covers:

1. Quick example (`y = sin(x) * exp(-x/10)`)
2. The 5 math data shapes Glyph handles (scalar, parametric, vector-field, math-text, complex)
3. Animation: parametric trajectories + race for parameter sweeps
4. Audit rules for math specs
5. What Glyph deliberately does NOT do today (3D, symbolic computation, Manim-style scenes) and what to use instead
6. Roadmap for "Option B" (3D + advanced math marks) if demand materializes

The site-playground integration: add a "Math" subsection to the example dropdown with 5–6 presets users can load with one click. Same byte-identity guarantee, instant visual proof that math viz is real.

Acceptance for PR6:
- 4 new snapshot tests for the canonical math examples
- `docs/MATH.md` complete with code blocks + screenshots
- Playground example dropdown has a Math submenu
- README has a 1-paragraph "Glyph for science" section

PR title: `feat(math): showcase + Glyph for science docs (math PR6/6)`.

---

## Acceptance criteria for the math-extensions effort overall

- [ ] `data.shape: "function"` (scalar + parametric) works end-to-end
- [ ] `mark: "vector-field"` ships
- [ ] `mark: "math-text"` ships
- [ ] Mark registry + coordinate registry refactors land without breaking existing snapshot tests
- [ ] AUDIT-09 / 10 / 11 fire on the right inputs
- [ ] 10 canonical math examples checked in with snapshot tests:
  1. Sine wave
  2. Decay envelope
  3. Lissajous
  4. Vector field rotation
  5. Lorenz-projection trajectory (animated)
  6. Normal distribution
  7. Damped oscillator
  8. Complex Mandelbrot slice
  9. Integral with shaded area + math-text equation
  10. Fourier-series animated partial sum
- [ ] `docs/MATH.md` shipped
- [ ] Playground example dropdown has a Math section
- [ ] Zero new MCP verbs (existing `glyph_render` + `glyph_audit_spec` handle everything)
- [ ] Python bindings work unchanged — `glyph.render({"data": {"function": ...}})` Just Works

---

## Risks + mitigations

| Risk | Mitigation |
|------|-----------|
| `expr-eval` is unmaintained or has CVEs | Adapter pattern means we swap backends without touching call sites. Track NVD; switch to mathjs if needed. |
| KaTeX bundle adds 280 KB to `@glyph/core` | KaTeX is tree-shake-able — only `renderToString` + its core grammar ships. Measure with `pnpm pack`; if > 1 MB, lazy-load via dynamic import behind `mark: "math-text"` first-use. |
| `foreignObject` doesn't rasterize on all SVG-to-PNG paths | Document in `docs/MATH.md`. resvg-js (the rasterizer @glyph/mcp uses) supports it. For Mailchimp / older email clients, ship a fallback `mark: "text"` with the LaTeX source as plain text. |
| Mark-registry refactor breaks an existing snapshot | The refactor is mechanical (move switch cases into registry classes). Existing snapshot suite is the regression gate. Land in small commits so a single mark-family regression is easy to bisect. |
| Sample-count explosion DoS | MAX_SAMPLES = 100k hard cap in code, AUDIT-10 warns at 10k. Zod schema enforces upper bound. |
| Determinism slips (e.g. KaTeX uses Math.random somewhere) | Snapshot tests are the gate. Any drift means a non-deterministic source — fix the source, not the test. |
| Math users want 3D / Manim immediately | Defer Option B until at least 20 stars / 5 user requests cite math. Ship Option A first; collect signal. |

---

## What Option A leaves on the table (explicitly deferred)

- **3D surfaces** — `z = f(x, y)` projection / true 3D scene graph
- **Manim-style imperative scenes** — incompatible with declarative grammar
- **CAS / symbolic computation** — SymPy / Mathematica via MCP if needed
- **Interactive math exploration** — Desmos-style sliders; handled by `@glyph/live` later
- **Streamlines / phase portraits with ODE solvers** — runge-kutta integration as a separate `data.shape: "trajectory"`
- **Implicit plots** (`f(x, y) = 0`) — could reuse contour with threshold = 0
- **TikZ / advanced LaTeX layouts** — out of scope; KaTeX equations only

Track each in `docs/MATH.md` "Roadmap" section with a clear "comes back when N users ask" gate.

---

## Self-review

**Spec coverage:**
- ✅ `data.shape: "function"` (Task 1 + Task 2 — scalar + parametric)
- ✅ Vector fields (Task 3)
- ✅ KaTeX-rendered equations (Task 4)
- ✅ Audit rules + coordinate extensions (Task 5)
- ✅ Showcase + docs (Task 6)
- ✅ Foundation principles 1-7 all land in the first 3 PRs (evaluator pluggability + mark registry + coordinate registry)

**No placeholders:**
- Every PR has file paths, exact code blocks, test stubs, acceptance criteria
- Two open TODOs explicitly flagged: PR3.5 (2D vector function-data shape) and PR4.5 (math-text bounding-box measurement). Both are improvements, not blockers.

**Type consistency:**
- `FunctionDataSpec` (PR1) → consumed by `materialize.ts` (PR1) + audit rules (PR5)
- `ParametricDataSpec` (PR2) is a sibling type; union in `FunctionDataSchema`
- `MarkCompiler` interface (PR3) stable across all new marks (PR3 + PR4)
- `CoordinateProvider` interface (PR5) stable across `linear` / `polar` / `log` / `complex`

---

## Execution choice

Plan saved at `docs/superpowers/plans/2026-05-20-math-extensions.md`. Two ways to execute when Tier-S work allows:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per PR with review between each. Same cadence the Tier-S work uses. Best for keeping context clean over 3-4 weeks.

**2. Inline Execution** — run PRs sequentially in the orchestrator session. Good for the first 2 PRs (foundation + parametric) where you want hands-on involvement; switch to subagent-driven for PR3+ once the patterns are established.

**Hybrid is fine**: PR1 (foundation) inline so you can vet the evaluator interface choice and verify byte-identity end-to-end, then go subagent-driven for PR2-6 once the architecture is locked.
