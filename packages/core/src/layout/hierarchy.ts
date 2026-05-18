/**
 * Hierarchy layouts — PR67 / D3 Gap 2.
 *
 * Pure-fn layout algorithms over a recursive `HierarchyNode` tree. No
 * dependencies on the compiler / scenegraph — the compiler reads these
 * positions and emits the appropriate SceneMark (rect for treemap, arc
 * for sunburst).
 *
 * Algorithms implemented:
 *   - `hierarchyValues`  — fold leaf values upward (D3.hierarchy().sum)
 *   - `squarifiedTreemap` — D3's squarified treemap (Bruls et al. 2000)
 *   - `partitionLayout`  — radial partition for sunburst
 *
 * All are deterministic; tie-breaking is first-seen order (matches the
 * input tree's child order).
 */

import type { HierarchyNode } from "../spec/types.js";

/** A laid-out node with its rectangle (treemap) or annular sector (sunburst). */
export interface LaidOutRectNode {
  readonly name: string;
  /** Hierarchy depth: root = 0, immediate children = 1, etc. */
  readonly depth: number;
  /** Sum of value across the subtree rooted at this node. */
  readonly value: number;
  /** Pixel rectangle. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Direct children rectangles, if any. */
  readonly children?: ReadonlyArray<LaidOutRectNode>;
}

/** A laid-out node in polar (angle, radius) space — sunburst output. */
export interface LaidOutArcNode {
  readonly name: string;
  readonly depth: number;
  readonly value: number;
  /** Start / end angle in radians (clockwise from 12-o'clock). */
  readonly startAngle: number;
  readonly endAngle: number;
  /** Inner / outer radius in pixels. */
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly children?: ReadonlyArray<LaidOutArcNode>;
}

// ---------------------------------------------------------------------------
// hierarchyValues — fold values bottom-up
// ---------------------------------------------------------------------------

/**
 * Compute the cumulative value of every node by summing leaf values
 * upward. Leaves keep their own `value` (default 1 if missing); interior
 * nodes' value equals the sum of their children. Returns a parallel tree
 * with `_value` filled in; the input tree is not mutated.
 */
interface ValuedNode {
  readonly name: string;
  readonly value: number;
  readonly depth: number;
  readonly children?: ReadonlyArray<ValuedNode>;
}

export function hierarchyValues(root: HierarchyNode, depth = 0): ValuedNode {
  if (!root.children || root.children.length === 0) {
    return { name: root.name, value: root.value ?? 1, depth };
  }
  const children = root.children.map((c) => hierarchyValues(c, depth + 1));
  const sum = children.reduce((s, c) => s + c.value, 0);
  // Honor an explicit interior value if greater than the sum (rare; D3
  // treats this as "this node has its own quota" — we follow that).
  const value = root.value !== undefined && root.value > sum ? root.value : sum;
  return { name: root.name, value, depth, children };
}

// ---------------------------------------------------------------------------
// Squarified treemap (Bruls, Huijing, van Wijk 2000)
// ---------------------------------------------------------------------------

/**
 * Lay out `root` inside `[x0, y0, x1, y1]` using the squarified algorithm.
 * Returns the laid-out tree with one rect per node (root has the full
 * bounds; descendants tile within their parent).
 *
 * The squarified algorithm minimizes the maximum aspect-ratio across all
 * placed rectangles by greedily filling the shorter side of the current
 * row. Same input → same output (deterministic, no RNG).
 */
export function squarifiedTreemap(
  root: HierarchyNode,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): LaidOutRectNode {
  const valued = hierarchyValues(root);
  return layoutNode(valued, x0, y0, x1, y1);
}

function layoutNode(
  node: ValuedNode,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): LaidOutRectNode {
  const base: LaidOutRectNode = {
    name: node.name,
    depth: node.depth,
    value: node.value,
    x0,
    y0,
    x1,
    y1,
  };
  if (!node.children || node.children.length === 0) return base;
  const childRects = squarify(node.children, x0, y0, x1, y1);
  const children = node.children.map((c, i) => {
    const r = childRects[i];
    if (!r) return layoutNode(c, x0, y0, x0, y0);
    return layoutNode(c, r.x0, r.y0, r.x1, r.y1);
  });
  return { ...base, children };
}

interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function squarify(
  children: ReadonlyArray<ValuedNode>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Rect[] {
  // Sort by value desc — squarified treemap prefers larger boxes first.
  const indexed = children.map((c, i) => ({ c, i }));
  indexed.sort((a, b) => b.c.value - a.c.value);
  const total = children.reduce((s, c) => s + c.value, 0);
  if (total === 0) return children.map(() => ({ x0, y0, x1: x0, y1: y0 }));
  const W = x1 - x0;
  const H = y1 - y0;
  const area = W * H;
  // Scale each value to occupy a proportional area.
  const scaled = indexed.map(({ c, i }) => ({ value: (c.value / total) * area, originalIndex: i }));
  // Squarified algorithm: pack into rows along the shorter side.
  const rects: Rect[] = new Array(children.length);
  let remaining = [...scaled];
  let cx0 = x0;
  let cy0 = y0;
  const cx1 = x1;
  const cy1 = y1;
  while (remaining.length > 0) {
    const shorter = Math.min(cx1 - cx0, cy1 - cy0);
    if (shorter <= 0) {
      // No room left — assign zero-area rects so we still emit valid output.
      for (const r of remaining) {
        rects[r.originalIndex] = { x0: cx0, y0: cy0, x1: cx0, y1: cy0 };
      }
      break;
    }
    // Greedily grow the current row while aspect ratio improves.
    let row: typeof remaining = [];
    let bestRatio = Number.POSITIVE_INFINITY;
    let i = 0;
    while (i < remaining.length) {
      const next = [...row, remaining[i] as (typeof remaining)[number]];
      const ratio = worstRatio(next, shorter);
      if (ratio > bestRatio) break;
      row = next;
      bestRatio = ratio;
      i++;
    }
    // Lay out the chosen row along the shorter side.
    const rowSum = row.reduce((s, r) => s + r.value, 0);
    const rowThickness = rowSum / shorter;
    const isVertical = cx1 - cx0 <= cy1 - cy0;
    let cursor = isVertical ? cx0 : cy0;
    for (const r of row) {
      const len = r.value / rowThickness;
      if (isVertical) {
        rects[r.originalIndex] = {
          x0: cursor,
          y0: cy0,
          x1: cursor + len,
          y1: cy0 + rowThickness,
        };
        cursor += len;
      } else {
        rects[r.originalIndex] = {
          x0: cx0,
          y0: cursor,
          x1: cx0 + rowThickness,
          y1: cursor + len,
        };
        cursor += len;
      }
    }
    // Advance the available rectangle past the row we just placed.
    if (isVertical) {
      cy0 += rowThickness;
    } else {
      cx0 += rowThickness;
    }
    remaining = remaining.slice(row.length);
  }
  return rects;
}

function worstRatio(row: ReadonlyArray<{ value: number }>, shorter: number): number {
  if (row.length === 0) return Number.POSITIVE_INFINITY;
  const sum = row.reduce((s, r) => s + r.value, 0);
  const thickness = sum / shorter;
  let worst = 0;
  for (const r of row) {
    const len = r.value / thickness;
    if (len === 0) continue;
    const ratio = Math.max(thickness / len, len / thickness);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Partition layout (sunburst / icicle)
// ---------------------------------------------------------------------------

/**
 * Lay out `root` as nested annular sectors. Children evenly divide their
 * parent's angular range proportional to value. Returns one arc per node
 * (root has 360°; descendants tile within their parent's slice).
 *
 * `startAngle` / `endAngle` are in radians, clockwise from 12-o'clock.
 */
export function partitionLayout(
  root: HierarchyNode,
  innerRadius: number,
  outerRadius: number,
  startAngle = 0,
  endAngle = 2 * Math.PI,
): LaidOutArcNode {
  const valued = hierarchyValues(root);
  const maxDepth = depthOf(valued);
  const ringStep = maxDepth === 0 ? 0 : (outerRadius - innerRadius) / maxDepth;
  return layoutArcNode(valued, startAngle, endAngle, innerRadius, ringStep);
}

function depthOf(node: ValuedNode): number {
  if (!node.children || node.children.length === 0) return node.depth;
  let m = node.depth;
  for (const c of node.children) {
    const cd = depthOf(c);
    if (cd > m) m = cd;
  }
  return m;
}

function layoutArcNode(
  node: ValuedNode,
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  ringStep: number,
): LaidOutArcNode {
  const r0 = innerRadius + node.depth * ringStep;
  const r1 = r0 + ringStep;
  const base: LaidOutArcNode = {
    name: node.name,
    depth: node.depth,
    value: node.value,
    startAngle,
    endAngle,
    innerRadius: r0,
    outerRadius: r1,
  };
  if (!node.children || node.children.length === 0) return base;
  const total = node.children.reduce((s, c) => s + c.value, 0);
  const sweep = endAngle - startAngle;
  let cursor = startAngle;
  const children: LaidOutArcNode[] = [];
  for (const c of node.children) {
    const share = total === 0 ? 0 : (c.value / total) * sweep;
    children.push(layoutArcNode(c, cursor, cursor + share, innerRadius, ringStep));
    cursor += share;
  }
  return { ...base, children };
}

// ---------------------------------------------------------------------------
// Tree-walk helper (flattens a laid-out tree into a list, depth-first)
// ---------------------------------------------------------------------------

export function flattenRects(node: LaidOutRectNode): LaidOutRectNode[] {
  const out: LaidOutRectNode[] = [node];
  if (node.children) {
    for (const c of node.children) out.push(...flattenRects(c));
  }
  return out;
}

export function flattenArcs(node: LaidOutArcNode): LaidOutArcNode[] {
  const out: LaidOutArcNode[] = [node];
  if (node.children) {
    for (const c of node.children) out.push(...flattenArcs(c));
  }
  return out;
}
