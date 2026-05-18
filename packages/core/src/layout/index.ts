/**
 * Layout module — PR67+ / D3 Gap 2 + Gap 5.
 *
 * Pure-fn algorithms that turn declarative structures (hierarchies, graphs)
 * into per-node pixel positions. The compiler reads these positions and
 * emits the appropriate SceneMark. Each algorithm is in its own file so
 * consumers can tree-shake.
 *
 * Shipped:
 *   - hierarchy.ts: squarified treemap, partition (sunburst)
 *   - force.ts (PR68): seeded force simulation for graph + beeswarm
 */

export * from "./hierarchy.js";
export * from "./force.js";
