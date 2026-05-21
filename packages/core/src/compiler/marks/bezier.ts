/**
 * Math Phase 2 Track A PR A5 — `mark: "bezier"`.
 *
 * Renders an N-degree Bezier curve from a sequence of control points
 * (3+ points = quadratic, cubic, quartic, …). Optionally overlays
 * the control polygon and the per-level de Casteljau construction
 * lines at a given parameter `t` — a single image that visualizes
 * exactly *how* the algorithm reduces N control points down to one
 * point on the curve. This is the canonical "show me how a Bezier is
 * built" picture (the one every classic graphics textbook shows next
 * to the de Casteljau pseudocode).
 *
 * --- Compile pipeline ---
 *   1. Read `layer.bezier.{controlPoints, samples?, showControls?,
 *      showConstruction?, t?}` (config lives in a nested block to
 *      mirror the streamline / annotation / traveler patterns).
 *   2. Sample the curve at `samples + 1` evenly spaced parameter
 *      values via de Casteljau and emit one `path` SceneMark.
 *   3. When `showControls`: emit a dashed `path` polyline through the
 *      control points + a small filled `circle` at each control.
 *   4. When `showConstruction` AND `t` is set: compute every
 *      intermediate de Casteljau level at that `t` and emit each as
 *      its own dashed `path` polyline. Level 0 (the control polygon)
 *      is skipped if `showControls` already drew it; otherwise it is
 *      emitted as the first construction-line layer.
 *
 * --- Determinism ---
 *   - de Casteljau is a pure linear interpolation tree; the same
 *     control points + same `t` produce the same intermediate points
 *     across every platform (IEEE-754 addition / multiplication is
 *     stable).
 *   - Every pixel coordinate runs through `roundPx`, matching the
 *     streamline / function / trajectory marks' byte-identity
 *     contract.
 *   - Construction lines are emitted in a fixed order: top-down
 *     (level 0 first, then level 1, …, ending with level N-2, the
 *     final two-point line whose midpoint is the curve sample at
 *     `t`). This ordering is documented so the SVG `<path>` sequence
 *     stays stable as the spec evolves.
 */
import type { SceneMark } from "../../scenegraph/types.js";
import { type MarkCompileArgs, type MarkCompiler, registerMark } from "../mark-registry.js";
import { roundPx } from "../scales.js";

/** Default sample count when `bezier.samples` is unset. 100 → 101 points. */
const DEFAULT_SAMPLES = 100;

/** Stroke widths for the curve / control polygon / construction lines. */
const CURVE_STROKE_WIDTH = 1.6;
const CONTROL_STROKE_WIDTH = 1;
const CONSTRUCTION_STROKE_WIDTH = 1;
/** Radius of the small circle marker drawn at each control point. */
const CONTROL_POINT_RADIUS = 3;
/** Dash pattern for the control polygon. */
const CONTROL_DASH = "4 3";
/** Dash pattern for de Casteljau construction lines. */
const CONSTRUCTION_DASH = "2 2";

/** A 2D point in data space. */
export interface BezierPoint {
  readonly x: number;
  readonly y: number;
}

/** Read + lightly validate the layer's `bezier` config block. */
interface BezierConfig {
  readonly controlPoints: ReadonlyArray<BezierPoint>;
  readonly samples: number;
  readonly showControls: boolean;
  readonly showConstruction: boolean;
  readonly t: number | undefined;
  readonly stroke: string | undefined;
  readonly strokeWidth: number | undefined;
  readonly fill: string | undefined;
}

function readConfig(layer: unknown): BezierConfig | undefined {
  if (typeof layer !== "object" || layer === null) return undefined;
  const b = (layer as { bezier?: unknown }).bezier;
  if (typeof b !== "object" || b === null) return undefined;
  const r = b as Record<string, unknown>;
  if (!Array.isArray(r.controlPoints) || r.controlPoints.length < 2) return undefined;
  const cps: BezierPoint[] = [];
  for (const raw of r.controlPoints) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const p = raw as { x?: unknown; y?: unknown };
    const x = Number(p.x);
    const y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    cps.push({ x, y });
  }
  const samples =
    typeof r.samples === "number" && Number.isInteger(r.samples) && r.samples > 0
      ? r.samples
      : DEFAULT_SAMPLES;
  const showControls = r.showControls === true;
  const showConstruction = r.showConstruction === true;
  const tRaw = r.t;
  const t =
    typeof tRaw === "number" && Number.isFinite(tRaw) && tRaw >= 0 && tRaw <= 1 ? tRaw : undefined;
  const stroke = typeof r.stroke === "string" && r.stroke.length > 0 ? r.stroke : undefined;
  const strokeWidth =
    typeof r.strokeWidth === "number" && Number.isFinite(r.strokeWidth) && r.strokeWidth > 0
      ? r.strokeWidth
      : undefined;
  const fill = typeof r.fill === "string" && r.fill.length > 0 ? r.fill : undefined;
  return {
    controlPoints: cps,
    samples,
    showControls,
    showConstruction,
    t,
    stroke,
    strokeWidth,
    fill,
  };
}

/**
 * One step of de Casteljau's algorithm: linearly interpolate each
 * consecutive pair of points by `t`. Reduces an array of N points to
 * an array of N - 1 points. Pure function — no mutation, no allocation
 * beyond the returned array.
 */
function deCasteljauStep(points: ReadonlyArray<BezierPoint>, t: number): BezierPoint[] {
  const out: BezierPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as BezierPoint;
    const b = points[i + 1] as BezierPoint;
    out.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
  }
  return out;
}

/**
 * Evaluate the Bezier curve at parameter `t` via de Casteljau
 * (recursive reduction until a single point remains). Pure;
 * IEEE-754 stable.
 */
export function evaluateBezier(points: ReadonlyArray<BezierPoint>, t: number): BezierPoint {
  let cur: ReadonlyArray<BezierPoint> = points;
  while (cur.length > 1) {
    cur = deCasteljauStep(cur, t);
  }
  return cur[0] as BezierPoint;
}

/**
 * Sample the Bezier curve at `samples + 1` evenly spaced parameter
 * values in [0, 1]. The first sample is exactly the first control
 * point and the last is exactly the last control point (both are
 * de Casteljau fixed points at t=0 / t=1).
 */
export function sampleBezier(
  points: ReadonlyArray<BezierPoint>,
  samples: number,
): BezierPoint[] {
  if (points.length < 2 || samples < 1) return [];
  const out: BezierPoint[] = new Array(samples + 1);
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    out[i] = evaluateBezier(points, t);
  }
  return out;
}

/**
 * Return every intermediate de Casteljau polyline at parameter `t`.
 * Index 0 is the input control polygon (N points), index 1 is the
 * first reduction (N - 1 points), …, index N - 2 is the final
 * two-point line whose midpoint is the curve sample at `t`. The
 * single-point N - 1 level is intentionally excluded (a single point
 * is not a polyline — the curve sample itself stands in for it).
 */
export function deCasteljauLevels(
  points: ReadonlyArray<BezierPoint>,
  t: number,
): BezierPoint[][] {
  const levels: BezierPoint[][] = [];
  let cur: BezierPoint[] = points.map((p) => ({ x: p.x, y: p.y }));
  while (cur.length >= 2) {
    levels.push(cur);
    cur = deCasteljauStep(cur, t);
  }
  return levels;
}

/**
 * Convert a polyline of *pixel-space* points to an SVG `d` attribute
 * (`M x y L x y L x y …`). Coordinates are emitted as raw numbers —
 * the caller is expected to have run them through `roundPx` already
 * (matches the streamline / line mark convention).
 *
 * Returns the empty string for a degenerate (< 2 points) polyline so
 * the caller can skip the SceneMark instead of emitting an empty
 * path.
 */
export function polylineToSvgD(points: ReadonlyArray<BezierPoint>): string {
  if (points.length < 2) return "";
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as BezierPoint;
    d += `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`;
    if (i < points.length - 1) d += " ";
  }
  return d;
}

/**
 * Project a list of data-space points to pixel space + run each
 * coordinate through `roundPx`. Drops any point whose projected
 * coordinates are non-finite.
 */
function projectAndRound(
  points: ReadonlyArray<BezierPoint>,
  xScale: { apply: (v: number) => number },
  yScale: { apply: (v: number) => number },
): BezierPoint[] {
  const out: BezierPoint[] = [];
  for (const p of points) {
    const px = roundPx(xScale.apply(p.x));
    const py = roundPx(yScale.apply(p.y));
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    out.push({ x: px, y: py });
  }
  return out;
}

export const bezierMarkCompiler: MarkCompiler = {
  type: "bezier",
  compile(args: MarkCompileArgs): void {
    const { xScale, yScale, theme, out, layer } = args;
    if (!yScale) return;
    // Bezier requires a numeric x axis. Categorical (band) doesn't
    // make sense for control points living in a continuous space.
    if (xScale.type !== "linear") return;

    const cfg = readConfig(layer);
    if (!cfg) return;
    if (cfg.controlPoints.length < 2) return;

    const curveStroke = cfg.stroke ?? (theme.marks[0] ?? theme.fg);
    const curveFill = cfg.fill ?? "none";
    const curveWidth = cfg.strokeWidth ?? CURVE_STROKE_WIDTH;
    // Helper colors derived from theme. The control polygon + the
    // de Casteljau construction lines render in theme.axis (a muted
    // secondary that contrasts with the bright primary curve).
    const helperStroke = theme.axis;
    const helperFill = theme.background;

    // ---- 1. Sample the curve --------------------------------------
    const curveSamples = sampleBezier(cfg.controlPoints, cfg.samples);
    const projected = projectAndRound(curveSamples, xScale, yScale);
    const curveD = polylineToSvgD(projected);
    if (curveD.length > 0) {
      const curveMark: SceneMark = {
        type: "path",
        d: curveD,
        stroke: curveStroke,
        strokeWidth: curveWidth,
        fill: curveFill,
      };
      out.push(curveMark);
    }

    // ---- 2. de Casteljau construction lines at `t` -----------------
    // Emit BEFORE the control polygon so the polygon (and its dots)
    // render on top of the construction overlay. Construction lines
    // skip level 0 when `showControls` is true (the control polygon
    // gets a dedicated emit below with the control-polygon style).
    let constructionLevels: BezierPoint[][] = [];
    if (cfg.showConstruction && cfg.t !== undefined) {
      const allLevels = deCasteljauLevels(cfg.controlPoints, cfg.t);
      // Skip level 0 here when controls are drawn separately — it
      // would render the same vertices twice with two dash patterns
      // overlapping. When controls are NOT drawn, level 0 IS the
      // control polygon for visual context.
      constructionLevels = cfg.showControls ? allLevels.slice(1) : allLevels;
      for (const level of constructionLevels) {
        const pp = projectAndRound(level, xScale, yScale);
        const d = polylineToSvgD(pp);
        if (d.length === 0) continue;
        const path: SceneMark = {
          type: "path",
          d,
          stroke: helperStroke,
          strokeWidth: CONSTRUCTION_STROKE_WIDTH,
          fill: "none",
          strokeDasharray: CONSTRUCTION_DASH,
        };
        out.push(path);
      }
    }

    // ---- 3. Control polygon + control-point markers ----------------
    if (cfg.showControls) {
      const ctrlPx = projectAndRound(cfg.controlPoints, xScale, yScale);
      const polyD = polylineToSvgD(ctrlPx);
      if (polyD.length > 0) {
        const polyMark: SceneMark = {
          type: "path",
          d: polyD,
          stroke: helperStroke,
          strokeWidth: CONTROL_STROKE_WIDTH,
          fill: "none",
          strokeDasharray: CONTROL_DASH,
        };
        out.push(polyMark);
      }
      for (const p of ctrlPx) {
        const dot: SceneMark = {
          type: "circle",
          cx: p.x,
          cy: p.y,
          r: CONTROL_POINT_RADIUS,
          fill: helperFill,
          stroke: helperStroke,
          strokeWidth: CONTROL_STROKE_WIDTH,
        };
        out.push(dot);
      }
    }

    // ---- 4. Highlight dot at the curve sample for `t` --------------
    // When construction is active, drop a small filled marker at
    // B(t) — the algorithm's terminal point — so the kid persona can
    // see "this is what de Casteljau is computing".
    if (cfg.showConstruction && cfg.t !== undefined) {
      const tip = evaluateBezier(cfg.controlPoints, cfg.t);
      const px = roundPx(xScale.apply(tip.x));
      const py = roundPx(yScale.apply(tip.y));
      if (Number.isFinite(px) && Number.isFinite(py)) {
        const tipMark: SceneMark = {
          type: "circle",
          cx: px,
          cy: py,
          r: CONTROL_POINT_RADIUS,
          fill: curveStroke,
          stroke: curveStroke,
          strokeWidth: CONTROL_STROKE_WIDTH,
        };
        out.push(tipMark);
      }
    }
  },
};

registerMark(bezierMarkCompiler);
