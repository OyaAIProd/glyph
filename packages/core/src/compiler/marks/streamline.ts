/**
 * Math Phase 2 Track A PR A3 — `mark: "streamline"`.
 *
 * The vector-field mark (Math PR3) renders discrete arrows at every grid
 * point. A streamline mark INTEGRATES that field into continuous flow
 * lines — the global structure becomes visible at a glance (rotation
 * fields show concentric circles, saddle fields show hyperbolic flow,
 * sources / sinks show radial spokes). It is the visual counterpart of
 * a phase portrait in dynamical systems.
 *
 * --- Compile pipeline ---
 *   1. Read `layer.streamline.{dxdt, dydt}` and compile them via the
 *      shared `expr-eval` evaluator (same backend the function and
 *      trajectory shapes use; same byte-determinism guarantees).
 *   2. Generate seed points — either an evenly-spaced `rows × cols`
 *      grid across the integration domain (`kind: "grid"`) or a
 *      caller-pinned list (`kind: "array"`).
 *   3. For each seed, integrate BOTH FORWARD AND BACKWARD via RK4.
 *      Streamlines are bidirectional curves through the seed; forward
 *      shows where a particle would go, backward shows where it came
 *      from. Termination conditions per direction:
 *        - step budget exhausted (`maxSteps` cap; DoS guard)
 *        - integration left the domain
 *        - derivative evaluated to a non-finite (NaN / +/-Infinity)
 *        - loop detected (the trajectory re-entered a visited cell on
 *          the seed-side cell grid)
 *   4. Each integrated polyline becomes ONE `<path>` SceneMark
 *      (`M x0 y0 L x1 y1 L ... L xN yN`). All coordinates run through
 *      `roundPx`, mirroring the `function` / `trajectory` mark
 *      determinism contract.
 *
 * --- Determinism gates ---
 *   - Same evaluator + same scope → same RK4 step (IEEE-754 stable).
 *   - Seed iteration order is the row-major grid order (or the user's
 *     array order); SceneMarks are emitted in that order so the SVG's
 *     `<path>` tag sequence is byte-identical across runs.
 *   - Loop detection uses an INTEGER cell hash on a `(domain_w / step,
 *     domain_h / step)` grid; pure integer math, no floating drift.
 *
 * --- RK4 step ---
 * Duplicated from `data/shapes/trajectory.ts` rather than refactored
 * into a shared helper — the trajectory snapshot tests are byte-locked
 * to the inlined form, and the integration logic is small enough that
 * a copy is cheaper than risking a cross-file refactor breaking those
 * tests. The autonomous-system path is also slightly different here
 * (no `t`-dependent right-hand-side; pure (x, y) scope), so a unified
 * helper would still need branching.
 */
import { EvaluationError, type Evaluator } from "../../eval/evaluator.js";
import { defaultEvaluator } from "../../eval/expr-eval-adapter.js";
import type { SceneMark } from "../../scenegraph/types.js";
import { type MarkCompileArgs, type MarkCompiler, registerMark } from "../mark-registry.js";
import { roundPx } from "../scales.js";

/** Default RK4 step (data units). Matches the schema default. */
const DEFAULT_STEP = 0.05;
/** Default per-direction iteration cap. Matches the schema default. */
const DEFAULT_MAX_STEPS = 500;
/** Default seed-grid resolution. Matches the schema default. */
const DEFAULT_SEED_ROWS = 5;
const DEFAULT_SEED_COLS = 5;
/**
 * Loop-detection grid resolution in `step` units. A revisited cell
 * within `step * 0.5` distance terminates that direction. We bucket
 * into integer cells of size `step` and stop when a cell is hit twice
 * — the threshold-of-half-a-step ensures a streamline that barely
 * grazes the cell border doesn't trigger a false positive on the
 * first iteration.
 */
const LOOP_CELL_SCALE = 1;

/** Internal RK4 state. */
interface State {
  readonly x: number;
  readonly y: number;
}

/**
 * One RK4 step on an autonomous 2D system (no `t` dependence).
 *
 *   k1 = f(x,           y          )
 *   k2 = f(x + h/2·k1x, y + h/2·k1y)
 *   k3 = f(x + h/2·k2x, y + h/2·k2y)
 *   k4 = f(x + h·k3x,   y + h·k3y  )
 *   x' = x + h/6·(k1x + 2·k2x + 2·k3x + k4x)
 *   y' = y + h/6·(k1y + 2·k2y + 2·k3y + k4y)
 *
 * Returns the new state; non-finite derivatives propagate via NaN so
 * the caller can terminate the streamline.
 */
function rk4Step(
  evaluator: Evaluator,
  dxdt: string,
  dydt: string,
  state: State,
  h: number,
): State {
  const { x, y } = state;
  const k1x = safeEval(evaluator, dxdt, { x, y });
  const k1y = safeEval(evaluator, dydt, { x, y });

  const x2 = x + (h * 0.5) * k1x;
  const y2 = y + (h * 0.5) * k1y;
  const k2x = safeEval(evaluator, dxdt, { x: x2, y: y2 });
  const k2y = safeEval(evaluator, dydt, { x: x2, y: y2 });

  const x3 = x + (h * 0.5) * k2x;
  const y3 = y + (h * 0.5) * k2y;
  const k3x = safeEval(evaluator, dxdt, { x: x3, y: y3 });
  const k3y = safeEval(evaluator, dydt, { x: x3, y: y3 });

  const x4 = x + h * k3x;
  const y4 = y + h * k3y;
  const k4x = safeEval(evaluator, dxdt, { x: x4, y: y4 });
  const k4y = safeEval(evaluator, dydt, { x: x4, y: y4 });

  return {
    x: x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x),
    y: y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y),
  };
}

/**
 * Evaluate a derivative expression; on undefined identifier OR
 * non-finite output, return NaN so the integrator terminates cleanly.
 * (Contrast with trajectory.ts which throws — there the spec author
 * gets a hard error because integration is the whole point; here a
 * NaN simply truncates one streamline and we keep going on the others.)
 */
function safeEval(
  evaluator: Evaluator,
  expr: string,
  scope: Record<string, number>,
): number {
  try {
    return evaluator(expr, scope);
  } catch (e) {
    if (e instanceof EvaluationError) return Number.NaN;
    throw e;
  }
}

/** Read + lightly validate the layer's `streamline` config. */
interface StreamlineConfig {
  readonly dxdt: string;
  readonly dydt: string;
  readonly seeds:
    | { readonly kind: "grid"; readonly rows: number; readonly cols: number }
    | {
        readonly kind: "array";
        readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
      };
  readonly step: number;
  readonly maxSteps: number;
  readonly domain:
    | { readonly x: readonly [number, number]; readonly y: readonly [number, number] }
    | undefined;
}

function readConfig(layer: unknown): StreamlineConfig | undefined {
  if (typeof layer !== "object" || layer === null) return undefined;
  const s = (layer as { streamline?: unknown }).streamline;
  if (typeof s !== "object" || s === null) return undefined;
  const r = s as Record<string, unknown>;
  if (typeof r.dxdt !== "string" || typeof r.dydt !== "string") return undefined;
  if (typeof r.seeds !== "object" || r.seeds === null) return undefined;
  const seedsRaw = r.seeds as Record<string, unknown>;
  let seeds: StreamlineConfig["seeds"];
  if (seedsRaw.kind === "grid") {
    const rows = typeof seedsRaw.rows === "number" ? seedsRaw.rows : DEFAULT_SEED_ROWS;
    const cols = typeof seedsRaw.cols === "number" ? seedsRaw.cols : DEFAULT_SEED_COLS;
    seeds = { kind: "grid", rows, cols };
  } else if (seedsRaw.kind === "array" && Array.isArray(seedsRaw.points)) {
    const points = (seedsRaw.points as ReadonlyArray<{ x: unknown; y: unknown }>)
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length === 0) return undefined;
    seeds = { kind: "array", points };
  } else {
    return undefined;
  }
  const step = typeof r.step === "number" && r.step > 0 ? r.step : DEFAULT_STEP;
  const maxSteps =
    typeof r.maxSteps === "number" && Number.isInteger(r.maxSteps) && r.maxSteps > 0
      ? r.maxSteps
      : DEFAULT_MAX_STEPS;
  let domain: StreamlineConfig["domain"];
  if (typeof r.domain === "object" && r.domain !== null) {
    const d = r.domain as { x?: unknown; y?: unknown };
    if (Array.isArray(d.x) && Array.isArray(d.y) && d.x.length === 2 && d.y.length === 2) {
      const dx = [Number(d.x[0]), Number(d.x[1])] as const;
      const dy = [Number(d.y[0]), Number(d.y[1])] as const;
      if (
        Number.isFinite(dx[0]) &&
        Number.isFinite(dx[1]) &&
        Number.isFinite(dy[0]) &&
        Number.isFinite(dy[1])
      ) {
        domain = { x: dx, y: dy };
      }
    }
  }
  return { dxdt: r.dxdt, dydt: r.dydt, seeds, step, maxSteps, domain };
}

/**
 * Integrate one direction from a seed. `sign` is +1 for forward, -1
 * for backward. Returns the integrated polyline INCLUDING the seed
 * point at index 0. The seed always appears at index 0 so the two
 * directions can be stitched by reversing the backward result and
 * appending the (seedless) forward result.
 */
function integrateDirection(
  evaluator: Evaluator,
  cfg: StreamlineConfig,
  domain: { x: readonly [number, number]; y: readonly [number, number] },
  seed: State,
  sign: 1 | -1,
): State[] {
  const out: State[] = [seed];
  const h = cfg.step * sign;
  // Loop-detection: bucket each visited point into an integer cell of
  // size `step`. Re-entering a cell terminates the direction.
  const visited = new Set<string>();
  const cellSize = cfg.step * LOOP_CELL_SCALE;
  const cellKey = (s: State): string => {
    const cx = Math.floor((s.x - domain.x[0]) / cellSize);
    const cy = Math.floor((s.y - domain.y[0]) / cellSize);
    return `${cx},${cy}`;
  };
  visited.add(cellKey(seed));
  let cur = seed;
  for (let i = 0; i < cfg.maxSteps; i++) {
    const next = rk4Step(evaluator, cfg.dxdt, cfg.dydt, cur, h);
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) break;
    if (
      next.x < domain.x[0] ||
      next.x > domain.x[1] ||
      next.y < domain.y[0] ||
      next.y > domain.y[1]
    ) {
      break;
    }
    const key = cellKey(next);
    if (visited.has(key) && i > 2) {
      // i > 2 lets us escape the seed cell before counting revisits;
      // otherwise tiny initial steps would falsely trigger.
      break;
    }
    visited.add(key);
    out.push(next);
    cur = next;
  }
  return out;
}

/** Generate seed points in row-major order. */
function generateSeeds(
  cfg: StreamlineConfig,
  domain: { x: readonly [number, number]; y: readonly [number, number] },
): State[] {
  if (cfg.seeds.kind === "array") {
    return cfg.seeds.points.map((p) => ({ x: p.x, y: p.y }));
  }
  const { rows, cols } = cfg.seeds;
  const [xMin, xMax] = domain.x;
  const [yMin, yMax] = domain.y;
  const seeds: State[] = [];
  // Inset seeds by half a cell on each side so a grid against the
  // exact domain edge isn't immediately clipped on its first step.
  const dx = (xMax - xMin) / (cols + 1);
  const dy = (yMax - yMin) / (rows + 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      seeds.push({ x: xMin + dx * (c + 1), y: yMin + dy * (r + 1) });
    }
  }
  return seeds;
}

export const streamlineMarkCompiler: MarkCompiler = {
  type: "streamline",
  compile(args: MarkCompileArgs): void {
    const { xScale, yScale, theme, out, layer } = args;
    if (!yScale) return;
    // Streamlines need numeric x/y; band scales (categorical) make
    // no physical sense for a continuous flow field.
    if (xScale.type !== "linear") return;

    const cfg = readConfig(layer);
    if (!cfg) return;

    // Domain resolution: explicit streamline.domain WINS; otherwise
    // fall back to the resolved x/y scale domains. The scale-domain
    // fallback means a fixture that sets `encoding.x.scale.domain`
    // gets exactly the streamline integration extent it asked for
    // (assuming the scale path honors it OR the rows in the test
    // anchor the same range).
    const domain: { x: readonly [number, number]; y: readonly [number, number] } = cfg.domain ?? {
      x: xScale.domain as readonly [number, number],
      y: yScale.domain as readonly [number, number],
    };
    if (
      !Number.isFinite(domain.x[0]) ||
      !Number.isFinite(domain.x[1]) ||
      !Number.isFinite(domain.y[0]) ||
      !Number.isFinite(domain.y[1])
    ) {
      // Degenerate domain (e.g. empty rows + no streamline.domain).
      // Skip silently — the user can either supply rows that anchor
      // the scale OR set streamline.domain explicitly.
      return;
    }

    const stroke = theme.fg;
    const evaluator: Evaluator = defaultEvaluator;
    const seeds = generateSeeds(cfg, domain);

    for (const seed of seeds) {
      // Backward (sign=-1) + forward (sign=+1); reverse the backward
      // result so the path reads from "past" through "seed" to "future".
      const back = integrateDirection(evaluator, cfg, domain, seed, -1);
      const fwd = integrateDirection(evaluator, cfg, domain, seed, 1);
      // back includes seed; drop the seed from fwd (idx 0) so the
      // stitched polyline doesn't duplicate it.
      const polyline = [...back.reverse(), ...fwd.slice(1)];
      if (polyline.length < 2) continue;

      // Build the SVG path's `d` attribute. Each (x, y) maps through
      // the resolved scale then `roundPx` for byte stability.
      let d = "";
      for (let i = 0; i < polyline.length; i++) {
        const p = polyline[i];
        if (!p) continue;
        const px = roundPx(xScale.apply(p.x));
        const py = roundPx(yScale.apply(p.y));
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        d += `${i === 0 ? "M" : "L"} ${px} ${py} `;
      }
      const dTrim = d.trim();
      if (dTrim.length === 0) continue;

      const path: SceneMark = {
        type: "path",
        d: dTrim,
        stroke,
        strokeWidth: 1.2,
        fill: "none",
      };
      out.push(path);
    }
  },
};

registerMark(streamlineMarkCompiler);
