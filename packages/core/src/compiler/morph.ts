/**
 * Morph between two compiled scenes — D3 Gap 3 (PR74).
 *
 * Pure function. Given two `Scene` objects compiled from related specs
 * (e.g. the same data with a different stack offset), returns a new
 * Scene whose `animation.kind = "morph"` carries `fromMarks` positionally
 * aligned to `marks`. The SVG renderer emits SMIL `<animate>` children
 * on each mark interpolating between corresponding geometric attrs.
 *
 * Determinism: same (from, to, duration) → same Scene bytes, same SVG.
 *
 * v0 scope:
 *   - rect → rect: animates x, y, width, height
 *   - circle → circle: animates cx, cy, r
 *   - path → path: NOT YET (SVG path interpolation requires a path
 *     parser that handles divergent command sequences). Throws when a
 *     pair mismatches.
 */

import type { Scene, SceneMark } from "../scenegraph/types.js";

/** Animatable scenes must satisfy these structural constraints. */
export interface MorphOptions {
  /** Total transition duration in ms. Default 600. */
  readonly duration_ms?: number;
}

/**
 * Build a morph Scene. The output uses `to`'s marks + axes + plot area;
 * `from`'s marks are attached as `animation.fromMarks` for the renderer.
 * Throws when mark counts or types don't align.
 */
export function morphScenes(from: Scene, to: Scene, options: MorphOptions = {}): Scene {
  const duration_ms = options.duration_ms ?? 600;
  if (from.marks.length !== to.marks.length) {
    throw new Error(
      `morphScenes: mark count differs (${from.marks.length} vs ${to.marks.length}). Morph v0 requires aligned mark sequences — typically the same spec rendered with two different aggregations / stack offsets.`,
    );
  }
  for (let i = 0; i < from.marks.length; i++) {
    const a = from.marks[i];
    const b = to.marks[i];
    if (!a || !b) continue;
    if (a.type !== b.type) {
      throw new Error(
        `morphScenes: marks[${i}] type mismatch (${a.type} vs ${b.type}). Both ends of a morph must have the same shape.`,
      );
    }
    if (a.type === "path" || a.type === "text" || a.type === "arc") {
      throw new Error(
        `morphScenes: mark type "${a.type}" is not supported in v0 — only rect, circle, and line can morph. Got marks[${i}].`,
      );
    }
  }
  return {
    ...to,
    animation: {
      kind: "morph",
      duration_ms,
      fromMarks: from.marks,
    },
  };
}
