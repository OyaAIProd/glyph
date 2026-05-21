/**
 * Math Phase 2 / Track A2 — deterministic polyline-length helper.
 *
 * Computes the geometric length of an SVG `d` string built by
 * `buildLines` / `buildAreas` / `buildContours`. Returns a number rounded
 * to 8 decimal places so the same input always yields the same length
 * across platforms — byte-stability propagates into the SMIL animation
 * markup that consumes this value.
 *
 * Supported commands: M, L, Z (the subset Glyph's path marks emit
 * today). Future curve types (Q, C, A) would need numerical integration;
 * this helper returns 0 if it encounters one rather than guessing.
 *
 * Why a custom helper instead of leaning on the browser
 * `SVGPathElement.getTotalLength()`? Because the compiler runs in
 * Node + Bun + Edge runtimes without a DOM, and we need bit-identical
 * output across all of them. The polyline approximation is exact for
 * the M/L/Z subset.
 */

import { roundPx } from "../compiler/scales.js";

const COMMAND_RE = /([MLZmlz])/g;

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Parse an SVG `d` string into a flat list of polyline points. Returns
 * an empty array for any input that contains an unsupported command —
 * callers should then treat the path as length-0 (graceful degradation).
 *
 * Each `M` starts a new subpath; the `Z` returns the pen to the most
 * recent subpath origin. The returned `lengths` accumulate segment
 * Euclidean distances in subpath order.
 */
function parseSegments(d: string): { ok: boolean; segments: ReadonlyArray<[Point, Point]> } {
  if (typeof d !== "string" || d.length === 0) {
    return { ok: true, segments: [] };
  }
  const tokens = d
    .replace(COMMAND_RE, " $1 ")
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);

  const segments: Array<[Point, Point]> = [];
  let i = 0;
  let subpathOrigin: Point | null = null;
  let current: Point | null = null;
  while (i < tokens.length) {
    const tok = tokens[i] as string;
    if (tok === "M" || tok === "m") {
      // Coords are absolute for M, relative for m. For now we only emit
      // absolute paths (M/L/Z), but support relative for defensive parse.
      const x = Number(tokens[i + 1]);
      const y = Number(tokens[i + 2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, segments: [] };
      const next: Point =
        tok === "m" && current ? { x: current.x + x, y: current.y + y } : { x, y };
      subpathOrigin = next;
      current = next;
      i += 3;
      // SVG quirk: M followed by extra coords is treated as implicit L.
      // We don't emit that today, but parse defensively in case future
      // path builders chain coords without re-stating L.
      while (i < tokens.length && tokens[i] !== undefined && !/^[A-Za-z]$/.test(tokens[i] ?? "")) {
        const lx = Number(tokens[i]);
        const ly = Number(tokens[i + 1]);
        if (!Number.isFinite(lx) || !Number.isFinite(ly)) return { ok: false, segments: [] };
        const nxt: Point =
          tok === "m" && current ? { x: current.x + lx, y: current.y + ly } : { x: lx, y: ly };
        if (current) segments.push([current, nxt]);
        current = nxt;
        i += 2;
      }
    } else if (tok === "L" || tok === "l") {
      const x = Number(tokens[i + 1]);
      const y = Number(tokens[i + 2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, segments: [] };
      const next: Point =
        tok === "l" && current ? { x: current.x + x, y: current.y + y } : { x, y };
      if (current) segments.push([current, next]);
      current = next;
      i += 3;
      // Implicit-L continuation: more coord pairs after the explicit L.
      while (i < tokens.length && tokens[i] !== undefined && !/^[A-Za-z]$/.test(tokens[i] ?? "")) {
        const lx = Number(tokens[i]);
        const ly = Number(tokens[i + 1]);
        if (!Number.isFinite(lx) || !Number.isFinite(ly)) return { ok: false, segments: [] };
        const nxt: Point =
          tok === "l" && current ? { x: current.x + lx, y: current.y + ly } : { x: lx, y: ly };
        if (current) segments.push([current, nxt]);
        current = nxt;
        i += 2;
      }
    } else if (tok === "Z" || tok === "z") {
      if (current && subpathOrigin) {
        segments.push([current, subpathOrigin]);
        current = subpathOrigin;
      }
      i += 1;
    } else {
      // Unsupported command (Q, C, A, H, V, S, T, …). Bail.
      return { ok: false, segments: [] };
    }
  }
  return { ok: true, segments };
}

/**
 * Compute the polyline length of an SVG `d` string. Deterministic,
 * pure, no DOM dependencies. Rounds the final value to 8 decimals via
 * `roundPx` so it round-trips byte-identically through JSON / SMIL
 * markup.
 *
 * Returns 0 for:
 *   - empty / non-string input
 *   - a path with only an `M` (no actual length to draw)
 *   - paths containing unsupported commands (Q/C/A/H/V/S/T)
 *
 * The graceful-zero behavior is intentional: a `draw-in` animation on a
 * zero-length path produces a no-op stroke-dashoffset animate, which
 * still validates as SVG and degrades to a static line.
 */
export function polylineLength(d: string): number {
  const { ok, segments } = parseSegments(d);
  if (!ok || segments.length === 0) return 0;
  let total = 0;
  for (const [a, b] of segments) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return roundPx(total);
}
