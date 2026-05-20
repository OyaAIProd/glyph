/**
 * Math PR3 — `mark: "vector-field"`.
 *
 * Renders one oriented arrow per row in the resolved data, anchored at
 * the row's (encoding.x, encoding.y) and pointing in the direction of
 * the (dx, dy) tangent vector. Arrow length is proportional to the
 * vector magnitude, clamped to a sensible pixel range so a stray large
 * vector doesn't blow up the chart.
 *
 * Expected row shape: `{ x, y, dx, dy }` where `x, y` is the sample
 * point and `dx, dy` is the field tangent at that point. PR3 keeps
 * rows hand-precomputed (user provides them or a future PR3.5 extends
 * the function-data shape to emit them from a 2D vector expression).
 *
 * Determinism: arrow direction is `atan2(dy, dx)` — IEEE-754 stable
 * across platforms — and length goes through a deterministic clamp.
 * No floating drift, no platform-specific math.
 */
import type { SceneMark } from "../../scenegraph/types.js";
import { type MarkCompileArgs, type MarkCompiler, registerMark } from "../mark-registry.js";
import { roundPx } from "../scales.js";

/** Pixel length range for arrow shafts. Magnitude × scale is clamped here. */
const MIN_LEN = 4;
const MAX_LEN = 24;
const MAG_SCALE = 8;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function fieldIndex(schema: ReadonlyArray<{ readonly name: string }>, name: string): number {
  return schema.findIndex((c) => c.name === name);
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

export const vectorFieldMarkCompiler: MarkCompiler = {
  type: "vector-field",
  compile(args: MarkCompileArgs): void {
    const { xScale, yScale, rows, schema, theme, out } = args;
    if (!yScale) return;
    // Vector fields require numeric x; the linear scale path is the only
    // one that makes physical sense (band scales are for categories).
    if (xScale.type !== "linear") return;

    const xIdx = fieldIndex(schema, args.xField);
    const yIdx = fieldIndex(schema, args.yField);
    const dxIdx = fieldIndex(schema, "dx");
    const dyIdx = fieldIndex(schema, "dy");
    if (xIdx < 0 || yIdx < 0 || dxIdx < 0 || dyIdx < 0) return;

    // Default arrow color: theme's foreground (so light themes render
    // dark arrows, dark themes render light arrows). Stays byte-stable
    // for a fixed theme.
    const stroke = theme.fg;

    for (const row of rows) {
      const xv = num(row[xIdx]);
      const yv = num(row[yIdx]);
      const dx = num(row[dxIdx]);
      const dy = num(row[dyIdx]);
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;

      const xpx = xScale.apply(xv);
      const ypx = yScale.apply(yv);
      if (!Number.isFinite(xpx) || !Number.isFinite(ypx)) continue;

      // Length: magnitude × scale, clamped so unscaled fields stay legible
      // and large magnitudes don't dominate.
      const magnitude = Math.sqrt(dx * dx + dy * dy);
      const length = clamp(magnitude * MAG_SCALE, MIN_LEN, MAX_LEN);
      // Screen y grows downward but the input vector lives in math space
      // (y grows up). Flip dy so the arrow points the math-correct way.
      const angle = Math.atan2(-dy, dx);

      const arrow: SceneMark = {
        type: "arrow",
        x: roundPx(xpx),
        y: roundPx(ypx),
        length: roundPx(length),
        angle,
        stroke,
        strokeWidth: 1.5,
      };
      out.push(arrow);
    }
  },
};

registerMark(vectorFieldMarkCompiler);
