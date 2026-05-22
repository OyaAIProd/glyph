/**
 * Joy of Math PR E1 — `mark: "annotation"`.
 *
 * A labeled callout that points at a chart feature. Useful for the
 * kid-persona Joy of Math workflows: "tell me what's interesting here"
 * → the agent emits a sine curve + an annotation pinned at the peak
 * reading "peak!".
 *
 * Spec shape:
 * ```json
 * {
 *   "mark": "annotation",
 *   "encoding": { "x": "x", "y": "y" },
 *   "annotation": {
 *     "anchor": { "kind": "coord", "x": 1.5708, "y": 1 },
 *     "text": "peak!",
 *     "arrow": "auto"           // or { dx: 40, dy: -30 } in PIXELS
 *   }
 * }
 * ```
 *
 * Pipeline:
 *   1. Resolve the anchor to pixel-space `(xpx, ypx)`. "data" mode reads
 *      row `rowIndex` from the materialized rows + projects via x/y
 *      scales; "coord" mode projects the literal data-space coord.
 *   2. Compute the arrow offset. `"auto"` picks a quadrant-based
 *      `(dx, dy)` so the bubble lands inside the plot area; an
 *      explicit `{dx, dy}` is interpreted verbatim in PIXELS (bubble
 *      layout is a pure-pixel concern).
 *   3. Emit four SceneMarks:
 *      - Highlight ring: optional circle at `(xpx, ypx)` so the kid
 *        sees what the arrow is pointing at (when `highlight: true`).
 *      - Arrow: a `path` shaft + a reused `arrow` SceneMark for the
 *        head (so we ride the same `glyph-arrow` <defs> marker the
 *        vector-field mark defines — SVG envelope stays minimal).
 *      - Bubble: a `rect` sized to the text via a coarse-em estimate
 *        (`fontSize * text.length * 0.55`, mirroring math-text's
 *        glyph-width heuristic).
 *      - Text: a `text` mark inside the bubble.
 *
 * Determinism:
 *   - Quadrant selection is a deterministic plot-area-center compare
 *     (no float-drift risk; plot area pixel bounds are integers).
 *   - Bubble width comes from a fixed-em estimate (same byte-stable
 *     trichotomy math-text uses).
 *   - All pixel coords run through `roundPx`.
 */
import type { SceneMark } from "../../scenegraph/types.js";
import type { Annotation } from "../../spec/types.js";
import { type MarkCompileArgs, type MarkCompiler, registerMark } from "../mark-registry.js";
import { roundPx } from "../scales.js";

/** Pixel offset magnitudes for the "auto" arrow placement. */
const AUTO_DX = 40;
const AUTO_DY = 30;

/** Bubble layout — em-relative padding around the text. */
const BUBBLE_PAD_X = 8;
const BUBBLE_PAD_Y = 4;
/** Highlight ring radius around the anchor (when annotation.highlight). */
const HIGHLIGHT_R = 5;

/**
 * Coarse text-width estimate. Mirrors math-text's glyph-width trichotomy
 * but flattened to a single multiplier so we don't need to inspect each
 * character — the bubble is large enough to read with comfortable margin
 * either way. `fontSize * text.length * 0.55` matches the average glyph
 * width math-text uses (`stringWidthEm` falls in [0.5, 0.6] for typical
 * ASCII strings).
 */
function estimateTextWidth(text: string, fontSize: number): number {
  return fontSize * text.length * 0.55;
}

/**
 * Quadrant-based "auto" arrow offset. The anchor's position within the
 * plot area picks which corner to nudge toward — we always offset INTO
 * the larger half so the bubble lands in open space rather than hugging
 * the edge.
 *
 *   - Anchor in upper-left quadrant of plot area → offset down-right
 *   - Anchor in upper-right → offset down-left
 *   - Anchor in lower-left → offset up-right
 *   - Anchor in lower-right → offset up-left
 */
function autoArrowOffset(
  xpx: number,
  ypx: number,
  plotArea: { x: number; y: number; width: number; height: number },
): { dx: number; dy: number } {
  const cx = plotArea.x + plotArea.width / 2;
  const cy = plotArea.y + plotArea.height / 2;
  const dx = xpx <= cx ? AUTO_DX : -AUTO_DX;
  const dy = ypx <= cy ? AUTO_DY : -AUTO_DY;
  return { dx, dy };
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

/**
 * Resolve a data-mode anchor to data-space (xv, yv) by looking up
 * `rowIndex` in the materialized rows.
 *
 * E1 review IMPORTANT-2: throws on out-of-bounds rowIndex / missing
 * encoding fields rather than silently dropping the annotation.
 * Earlier the function returned undefined for ANY error (missing row,
 * unknown field, non-finite value) and the compiler silently skipped
 * the mark — a typo in `rowIndex` made the whole annotation vanish
 * with no diagnostic. The Joy of Math UX needs fail-loud here.
 *
 * Non-finite cell values still return undefined (graceful skip
 * matching every other mark's row-filtering policy) — that's the
 * "missing data" path, not an authoring error.
 */
function resolveDataAnchor(
  rowIndex: number,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  schema: ReadonlyArray<{ readonly name: string }>,
  xField: string,
  yField: string,
): { xv: number; yv: number } | undefined {
  if (rowIndex >= rows.length) {
    throw new Error(
      `annotation: anchor.rowIndex ${rowIndex} is out of bounds (data has ${rows.length} rows). Use anchor.kind = 'coord' to anchor outside the data row index.`,
    );
  }
  const row = rows[rowIndex];
  if (!row) {
    // Sparse array — shouldn't happen with the standard row pipeline, but
    // fail loud if it does (consistent with the out-of-bounds case).
    throw new Error(
      `annotation: anchor.rowIndex ${rowIndex} is a sparse-array hole. The row pipeline shouldn't produce these.`,
    );
  }
  const xIdx = schema.findIndex((c) => c.name === xField);
  const yIdx = schema.findIndex((c) => c.name === yField);
  if (xIdx < 0 || yIdx < 0) {
    throw new Error(
      `annotation: encoding.x="${xField}" or encoding.y="${yField}" not found in schema (got: ${schema
        .map((c) => c.name)
        .join(", ")}). Either fix the field names or use anchor.kind = 'coord'.`,
    );
  }
  const xv = num(row[xIdx]);
  const yv = num(row[yIdx]);
  if (!Number.isFinite(xv) || !Number.isFinite(yv)) return undefined;
  return { xv, yv };
}

export const annotationMarkCompiler: MarkCompiler = {
  type: "annotation",
  compile(args: MarkCompileArgs): void {
    const { xScale, yScale, rows, schema, theme, out, layer, plotArea, xField, yField } = args;
    if (!yScale) return;
    // E1 review IMPORTANT-1: band x-scale used to silently emit
    // nothing. That kills the "label the tallest bar" use case
    // — the canonical Joy of Math example for annotations on bar
    // charts. v0 still doesn't support band-x annotations (the
    // band scale needs a string-keyed anchor, not a numeric one),
    // but we fail loud so the agent can fix the spec rather than
    // staring at a missing annotation.
    if (xScale.type !== "linear") {
      throw new Error(
        "annotation: this mark requires a linear x-scale today; " +
          "got a band x-scale. The current anchor shape is numeric (kind: 'coord' " +
          "uses {x, y} numbers; kind: 'data' projects row[xField] through xScale). " +
          "Band-scale support (categorical x) is queued for a follow-up.",
      );
    }

    const ann = (layer as { annotation?: Annotation }).annotation;
    if (!ann) return;

    // ---- Resolve the anchor in data space -----------------------------
    let xv: number;
    let yv: number;
    if (ann.anchor.kind === "coord") {
      xv = ann.anchor.x;
      yv = ann.anchor.y;
    } else {
      const resolved = resolveDataAnchor(ann.anchor.rowIndex, rows, schema, xField, yField);
      if (!resolved) return;
      xv = resolved.xv;
      yv = resolved.yv;
    }
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) return;

    // ---- Project to pixel space ---------------------------------------
    const xpx = xScale.apply(xv);
    const ypx = yScale.apply(yv);
    if (!Number.isFinite(xpx) || !Number.isFinite(ypx)) return;

    // ---- Resolve the arrow offset -------------------------------------
    let offset: { dx: number; dy: number };
    if (ann.arrow === "auto") {
      offset = autoArrowOffset(xpx, ypx, plotArea);
    } else {
      offset = { dx: ann.arrow.dx, dy: ann.arrow.dy };
    }

    // E1 review NIT-2: clamp the arrow tip + bubble center into the
    // plot area when the caller-supplied offset would push them
    // off-canvas. Auto-offset already steers toward the center; this
    // hardens the explicit-offset path so a typo (`{dx: 9999}`) doesn't
    // walk the bubble off-screen.
    const rawTipX = xpx + offset.dx;
    const rawTipY = ypx + offset.dy;
    const tipX = Math.min(Math.max(rawTipX, plotArea.x), plotArea.x + plotArea.width);
    const tipY = Math.min(Math.max(rawTipY, plotArea.y), plotArea.y + plotArea.height);
    const color = ann.color ?? theme.fg;

    // ---- Highlight ring around the anchor -----------------------------
    // Emitted FIRST so the arrow shaft renders on top — matches the
    // visual hierarchy "look here AND here's what we're pointing at".
    if (ann.highlight) {
      out.push({
        type: "circle",
        cx: roundPx(xpx),
        cy: roundPx(ypx),
        r: HIGHLIGHT_R,
        fill: "none",
        stroke: color,
        strokeWidth: 1.5,
      });
    }

    // ---- Arrow shaft + head -------------------------------------------
    // Re-use the `arrow` SceneMark type the vector-field mark defines so
    // the renderer's existing `glyph-arrow` <marker> def picks it up
    // automatically — no new SVG envelope, no new <defs>. The shaft
    // length + angle are derived from the CLAMPED tip so a clamped tip
    // still draws an arrow to the actual bubble position (rather than
    // pointing off-canvas where the raw tip would have been).
    const clampedDx = tipX - xpx;
    const clampedDy = tipY - ypx;
    const length = Math.sqrt(clampedDx * clampedDx + clampedDy * clampedDy);
    const angle = Math.atan2(clampedDy, clampedDx);
    out.push({
      type: "arrow",
      x: roundPx(xpx),
      y: roundPx(ypx),
      length: roundPx(length),
      angle,
      stroke: color,
      strokeWidth: 1.5,
    });

    // ---- Bubble rect + text -------------------------------------------
    // Bubble centered on the arrow tip. Width sized to the text plus
    // padding; height = fontSize + 2×pad. Keep coords rounded so we
    // remain byte-stable across runs.
    const textW = estimateTextWidth(ann.text, ann.fontSize);
    const bubbleW = textW + BUBBLE_PAD_X * 2;
    const bubbleH = ann.fontSize + BUBBLE_PAD_Y * 2;
    // Anchor the bubble on the FAR side of the arrow tip from the
    // anchor — i.e. shift the bubble in the direction of the arrow so
    // it doesn't overlap the anchor / arrow tail.
    const bubbleX = tipX - bubbleW / 2;
    const bubbleY = tipY - bubbleH / 2;
    out.push({
      type: "rect",
      x: roundPx(bubbleX),
      y: roundPx(bubbleY),
      width: roundPx(bubbleW),
      height: roundPx(bubbleH),
      fill: theme.background,
      stroke: color,
      strokeWidth: 1,
      // E1 review NIT-3: rounded corners read as a "speech bubble"
      // rather than a sharp-cornered data rect — exactly the
      // Joy of Math aesthetic the track is targeting. 6px matches
      // the bubble height proportions at fontSize=14.
      rx: 6,
    });
    out.push({
      type: "text",
      x: roundPx(tipX),
      y: roundPx(tipY),
      text: ann.text,
      fontSize: roundPx(ann.fontSize),
      fill: color,
      anchor: "middle",
      baseline: "middle",
    });
  },
};

registerMark(annotationMarkCompiler);
