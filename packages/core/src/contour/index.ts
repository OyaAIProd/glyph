/**
 * Contour / density surface — D3 Gap 4 (PR75).
 *
 * Pure-fn marching-squares implementation. Input: a 2D grid of scalar
 * values + an array of threshold levels. Output: one set of polyline
 * segments per threshold, ready for the compiler to emit as `path`
 * SceneMarks.
 *
 * Deterministic: traversal order is row-major, segment endpoints are
 * computed via linear interpolation between cell corners. No clock,
 * no RNG.
 *
 * Algorithm (Marching Squares, isovalue contours):
 *   For each 2×2 cell of the grid, classify each corner as "below" (0)
 *   or "above-or-equal" (1) the threshold. The 4-bit code identifies
 *   one of 16 cases; cases 1–14 produce 1 or 2 line segments through
 *   the cell, with endpoints linearly interpolated on the cell edges
 *   where the contour crosses. Cases 0 and 15 (all-below / all-above)
 *   produce nothing.
 *
 * Saddle ambiguity (cases 5, 10): two valid connectivities exist. v0
 * uses the "asymptotic decider" — the corner-averaged value picks
 * which way the contour bends. Matches D3-contour's behavior.
 */

/**
 * Input scalar field. `values` is row-major (length = rows × cols).
 * Cell (r, c) holds `values[r * cols + c]`.
 */
export interface ContourGrid {
  readonly rows: number;
  readonly cols: number;
  readonly values: ReadonlyArray<number>;
}

/** A polyline segment in cell-coordinate space (0..cols, 0..rows). */
export interface ContourSegment {
  readonly threshold: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Compute marching-squares contour segments for one or more thresholds.
 * Returns segments grouped by threshold; consumers can scale + emit as
 * path elements.
 */
export function marchingSquares(
  grid: ContourGrid,
  thresholds: ReadonlyArray<number>,
): ReadonlyArray<ContourSegment> {
  if (grid.rows < 2 || grid.cols < 2) {
    throw new Error(`marchingSquares: grid must be at least 2×2, got ${grid.rows}×${grid.cols}.`);
  }
  const expected = grid.rows * grid.cols;
  if (grid.values.length !== expected) {
    throw new Error(
      `marchingSquares: expected ${expected} values for ${grid.rows}×${grid.cols} grid, got ${grid.values.length}.`,
    );
  }
  const segments: ContourSegment[] = [];
  for (const t of thresholds) {
    if (!Number.isFinite(t)) continue;
    for (let r = 0; r < grid.rows - 1; r++) {
      for (let c = 0; c < grid.cols - 1; c++) {
        marchCell(grid, r, c, t, segments);
      }
    }
  }
  return segments;
}

/** Process one 2×2 cell at (r, c); push 0/1/2 segments per the 16 cases. */
function marchCell(
  grid: ContourGrid,
  r: number,
  c: number,
  t: number,
  out: ContourSegment[],
): void {
  // Corner positions: tl=(c, r), tr=(c+1, r), br=(c+1, r+1), bl=(c, r+1).
  const idx = (rr: number, cc: number): number => rr * grid.cols + cc;
  const vTL = grid.values[idx(r, c)] ?? 0;
  const vTR = grid.values[idx(r, c + 1)] ?? 0;
  const vBR = grid.values[idx(r + 1, c + 1)] ?? 0;
  const vBL = grid.values[idx(r + 1, c)] ?? 0;
  // 4-bit code: TL << 3 | TR << 2 | BR << 1 | BL.
  let code = 0;
  if (vTL >= t) code |= 8;
  if (vTR >= t) code |= 4;
  if (vBR >= t) code |= 2;
  if (vBL >= t) code |= 1;
  if (code === 0 || code === 15) return;
  // Interpolated edge crossings (in cell-coordinate space):
  //   N: top edge from TL→TR
  //   E: right edge from TR→BR
  //   S: bottom edge from BL→BR
  //   W: left edge from TL→BL
  const lerp = (lo: number, hi: number): number => {
    if (hi === lo) return 0.5;
    return (t - lo) / (hi - lo);
  };
  const N = (): { readonly x: number; readonly y: number } => ({
    x: c + lerp(vTL, vTR),
    y: r,
  });
  const E = (): { readonly x: number; readonly y: number } => ({
    x: c + 1,
    y: r + lerp(vTR, vBR),
  });
  const S = (): { readonly x: number; readonly y: number } => ({
    x: c + lerp(vBL, vBR),
    y: r + 1,
  });
  const W = (): { readonly x: number; readonly y: number } => ({
    x: c,
    y: r + lerp(vTL, vBL),
  });
  const push = (
    p1: { readonly x: number; readonly y: number },
    p2: { readonly x: number; readonly y: number },
  ): void => {
    out.push({ threshold: t, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
  };
  switch (code) {
    // Single-segment cases (one corner above or three corners above).
    case 1:
    case 14:
      push(W(), S());
      break;
    case 2:
    case 13:
      push(S(), E());
      break;
    case 3:
    case 12:
      push(W(), E());
      break;
    case 4:
    case 11:
      push(N(), E());
      break;
    case 6:
    case 9:
      push(N(), S());
      break;
    case 7:
    case 8:
      push(N(), W());
      break;
    // Saddle cases (5, 10) — two segments. Asymptotic decider picks the
    // connectivity using the corner-average: if the average is on the
    // same side as code's TL bit, segments "kiss" through the saddle.
    case 5: {
      const avg = (vTL + vTR + vBR + vBL) / 4;
      if (avg >= t) {
        push(N(), E());
        push(W(), S());
      } else {
        push(N(), W());
        push(S(), E());
      }
      break;
    }
    case 10: {
      const avg = (vTL + vTR + vBR + vBL) / 4;
      if (avg >= t) {
        push(N(), W());
        push(S(), E());
      } else {
        push(N(), E());
        push(W(), S());
      }
      break;
    }
  }
}

/**
 * Build an SVG path-d string from a contour segment list at one
 * threshold. Each segment becomes "M x1 y1 L x2 y2". Caller is
 * responsible for scaling cell coords to pixel space.
 */
export function segmentsToPathD(
  segments: ReadonlyArray<ContourSegment>,
  scale: (cellX: number, cellY: number) => { readonly x: number; readonly y: number },
): string {
  const parts: string[] = [];
  for (const s of segments) {
    const p1 = scale(s.x1, s.y1);
    const p2 = scale(s.x2, s.y2);
    parts.push(`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`);
  }
  return parts.join(" ");
}
