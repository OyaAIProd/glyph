/**
 * Force simulation — PR68 / D3 Gap 5.
 *
 * Pure-fn, **deterministic** force-directed layout. Uses a seeded
 * mulberry32 PRNG so the same `{ nodes, edges, seed }` input always
 * produces the same `(x, y)` outputs. No clock, no Math.random.
 *
 * Forces implemented:
 *   - center attraction (pulls every node toward the layout's center)
 *   - link spring (per-edge attraction with target length + strength)
 *   - charge repulsion (Barnes–Hut-style approximation skipped; v0 uses
 *     direct O(N²) repulsion which is fine up to ~500 nodes)
 *   - collision (prevents overlapping radii)
 *   - bounds (clamps positions to the layout rectangle)
 *
 * Two consumer paths:
 *   1. `simulateForce({ nodes, edges, ... })` — full graph layout.
 *      Returns `{ id, x, y }` per node.
 *   2. `simulateBeeswarm({ values, ... })` — 1D collision-resolved point
 *      layout for beeswarm-style scatters; uses only the collision +
 *      bounds forces along the y axis.
 *
 * Both return after a fixed iteration count (default 300) — no
 * convergence detection, since iteration count is the determinism knob.
 */

// ---------------------------------------------------------------------------
// Seeded RNG — mulberry32 (CC0). Tiny, deterministic, good enough.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForceNode {
  readonly id: string;
  /** Optional initial coordinates. When unset, seeded PRNG picks them. */
  readonly x?: number;
  readonly y?: number;
  /** Collision radius (default 4). */
  readonly r?: number;
}

export interface ForceEdge {
  readonly source: string;
  readonly target: string;
  /** Per-edge spring rest length (default 60). */
  readonly distance?: number;
}

export interface ForceLaidOutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface ForceOptions {
  /** Layout rectangle [x0, y0, x1, y1] in pixels. */
  readonly bounds: readonly [number, number, number, number];
  /** Number of simulation iterations (default 300; convergence proxy). */
  readonly iterations?: number;
  /** Repulsion strength (default -30; D3's default sign convention). */
  readonly chargeStrength?: number;
  /** Link spring strength ∈ [0, 1] (default 0.7). */
  readonly linkStrength?: number;
  /** Center attraction strength ∈ [0, 1] (default 0.05). */
  readonly centerStrength?: number;
  /** Seed for the PRNG that places nodes when initial xy isn't given. */
  readonly seed?: number;
}

// ---------------------------------------------------------------------------
// simulateForce — graph layout
// ---------------------------------------------------------------------------

export function simulateForce(
  nodes: ReadonlyArray<ForceNode>,
  edges: ReadonlyArray<ForceEdge>,
  options: ForceOptions,
): ReadonlyArray<ForceLaidOutNode> {
  const [x0, y0, x1, y1] = options.bounds;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const iter = options.iterations ?? 300;
  const charge = options.chargeStrength ?? -30;
  const linkS = options.linkStrength ?? 0.7;
  const centerS = options.centerStrength ?? 0.05;
  const seed = options.seed ?? 42;
  const rng = mulberry32(seed);

  // Initialize positions. Use given x/y if set, otherwise seeded random.
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  const idx = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    idx.set(n.id, i);
    xs.push(n.x ?? x0 + rng() * (x1 - x0));
    ys.push(n.y ?? y0 + rng() * (y1 - y0));
    rs.push(n.r ?? 4);
  }
  const vx = new Float64Array(nodes.length);
  const vy = new Float64Array(nodes.length);

  // Velocity-Verlet-ish loop. Each iteration: accumulate forces → update
  // velocities (with damping) → integrate positions → clamp to bounds.
  const damping = 0.6;

  for (let step = 0; step < iter; step++) {
    // Cool the temperature: forces taper as we converge. D3 uses alpha
    // decay; we use linear cooldown for predictability.
    const alpha = 1 - step / iter;

    // 1. Charge: O(N²) pairwise repulsion (Coulomb-like).
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const dx = (xs[j] ?? 0) - (xs[i] ?? 0);
        const dy = (ys[j] ?? 0) - (ys[i] ?? 0);
        const d2 = dx * dx + dy * dy + 0.01;
        const force = (charge * alpha) / d2;
        const fx = dx * force;
        const fy = dy * force;
        vx[i] = (vx[i] ?? 0) + fx;
        vy[i] = (vy[i] ?? 0) + fy;
        vx[j] = (vx[j] ?? 0) - fx;
        vy[j] = (vy[j] ?? 0) - fy;
      }
    }

    // 2. Links: spring force pulling endpoints toward `distance`.
    for (const e of edges) {
      const si = idx.get(e.source);
      const ti = idx.get(e.target);
      if (si === undefined || ti === undefined) continue;
      const dx = (xs[ti] ?? 0) - (xs[si] ?? 0);
      const dy = (ys[ti] ?? 0) - (ys[si] ?? 0);
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = e.distance ?? 60;
      const stretch = (d - rest) / d;
      const fx = dx * stretch * linkS * alpha;
      const fy = dy * stretch * linkS * alpha;
      vx[si] = (vx[si] ?? 0) + fx;
      vy[si] = (vy[si] ?? 0) + fy;
      vx[ti] = (vx[ti] ?? 0) - fx;
      vy[ti] = (vy[ti] ?? 0) - fy;
    }

    // 3. Center attraction.
    for (let i = 0; i < xs.length; i++) {
      vx[i] = (vx[i] ?? 0) + (cx - (xs[i] ?? 0)) * centerS * alpha;
      vy[i] = (vy[i] ?? 0) + (cy - (ys[i] ?? 0)) * centerS * alpha;
    }

    // 4. Collision: nudge overlapping pairs apart.
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        const dx = (xs[j] ?? 0) - (xs[i] ?? 0);
        const dy = (ys[j] ?? 0) - (ys[i] ?? 0);
        const d = Math.sqrt(dx * dx + dy * dy);
        const minDist = (rs[i] ?? 4) + (rs[j] ?? 4);
        if (d > 0 && d < minDist) {
          const overlap = (minDist - d) / 2;
          const ox = (dx / d) * overlap;
          const oy = (dy / d) * overlap;
          xs[i] = (xs[i] ?? 0) - ox;
          ys[i] = (ys[i] ?? 0) - oy;
          xs[j] = (xs[j] ?? 0) + ox;
          ys[j] = (ys[j] ?? 0) + oy;
        }
      }
    }

    // 5. Damping + integrate.
    for (let i = 0; i < xs.length; i++) {
      vx[i] = (vx[i] ?? 0) * damping;
      vy[i] = (vy[i] ?? 0) * damping;
      xs[i] = (xs[i] ?? 0) + (vx[i] ?? 0);
      ys[i] = (ys[i] ?? 0) + (vy[i] ?? 0);
      // 6. Clamp to bounds (account for radius).
      const r = rs[i] ?? 4;
      if ((xs[i] ?? 0) < x0 + r) xs[i] = x0 + r;
      if ((xs[i] ?? 0) > x1 - r) xs[i] = x1 - r;
      if ((ys[i] ?? 0) < y0 + r) ys[i] = y0 + r;
      if ((ys[i] ?? 0) > y1 - r) ys[i] = y1 - r;
    }
  }

  // Round to 8 decimals for cross-platform byte-identity.
  const out: ForceLaidOutNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    out.push({
      id: n.id,
      x: Math.round((xs[i] ?? 0) * 1e8) / 1e8,
      y: Math.round((ys[i] ?? 0) * 1e8) / 1e8,
      r: rs[i] ?? 4,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// simulateBeeswarm — 1D collision-resolved scatter
// ---------------------------------------------------------------------------

export interface BeeswarmInput {
  /** The x-coordinate per point (already mapped to pixel space). */
  readonly xs: ReadonlyArray<number>;
  /** Per-point radius. Same length as xs. */
  readonly rs: ReadonlyArray<number>;
  /** Baseline y. Points will spread above/below to avoid overlap. */
  readonly y: number;
  /** Vertical bounds (clamps swarm growth). */
  readonly yMin: number;
  readonly yMax: number;
  /** Iterations (default 60 — beeswarm converges quickly). */
  readonly iterations?: number;
  /** Seed for the order shuffle (otherwise: input order). */
  readonly seed?: number;
}

export interface BeeswarmPoint {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * 1D beeswarm: each point sits at its given x; y starts at the baseline
 * and the simulation nudges overlapping neighbours up or down to avoid
 * collision. Deterministic given a seed.
 */
export function simulateBeeswarm(input: BeeswarmInput): ReadonlyArray<BeeswarmPoint> {
  const { xs, rs, y, yMin, yMax } = input;
  const iter = input.iterations ?? 60;
  const seed = input.seed ?? 7;
  const rng = mulberry32(seed);
  const n = xs.length;
  // Start every point at the baseline with a tiny seeded jitter (otherwise
  // perfectly-stacked points never separate).
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) ys[i] = y + (rng() - 0.5) * 0.1;

  for (let step = 0; step < iter; step++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = (xs[j] ?? 0) - (xs[i] ?? 0);
        const dy = (ys[j] ?? 0) - (ys[i] ?? 0);
        const d = Math.sqrt(dx * dx + dy * dy);
        const minDist = (rs[i] ?? 4) + (rs[j] ?? 4);
        if (d > 0 && d < minDist) {
          // Push along y only — beeswarm preserves the x dimension.
          const overlapY = (minDist - d) * (dy / (d || 1));
          ys[i] = (ys[i] ?? 0) - overlapY * 0.5;
          ys[j] = (ys[j] ?? 0) + overlapY * 0.5;
        }
      }
      // Mild pull back toward the baseline.
      ys[i] = (ys[i] ?? 0) * 0.95 + y * 0.05;
      // Clamp.
      if ((ys[i] ?? 0) < yMin) ys[i] = yMin;
      if ((ys[i] ?? 0) > yMax) ys[i] = yMax;
    }
  }

  const out: BeeswarmPoint[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: Math.round((xs[i] ?? 0) * 1e8) / 1e8,
      y: Math.round((ys[i] ?? 0) * 1e8) / 1e8,
      r: rs[i] ?? 4,
    });
  }
  return out;
}
