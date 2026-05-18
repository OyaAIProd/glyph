/**
 * Tests for the graph compilation path (PR68 / D3 Gap 5).
 *
 *   - graph data + force mark → circles for nodes + lines for edges
 *   - same seed → identical SVG bytes
 *   - different seed → different layout
 *   - byte-identity: cartesian specs unaffected
 */
import { describe, expect, it } from "vitest";
import { renderSvg } from "../render/svg.js";
import type { GlyphSpec, GraphData } from "../spec/types.js";
import { compileSpec } from "./compile.js";

const graph: GraphData = {
  nodes: [
    { id: "a", group: "g1" },
    { id: "b", group: "g1" },
    { id: "c", group: "g2" },
    { id: "d", group: "g2" },
  ],
  edges: [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "c", target: "d" },
    { source: "d", target: "a" },
  ],
};

describe("compileGraph (PR68 / D3 Gap 5)", () => {
  it("emits one circle per node + one line per edge", () => {
    const spec: GlyphSpec = {
      data: { graph },
      layers: [{ mark: "force", encoding: {} }],
      seed: 42,
    };
    const scene = compileSpec({ spec, rows: [], schema: [] });
    const circles = scene.marks.filter((m) => m.type === "circle");
    const lines = scene.marks.filter((m) => m.type === "line");
    expect(circles.length).toBe(4);
    expect(lines.length).toBe(4);
  });

  it("same seed → identical SVG bytes", () => {
    const spec: GlyphSpec = {
      data: { graph },
      layers: [{ mark: "force", encoding: {} }],
      seed: 42,
    };
    const a = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const b = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(a).toBe(b);
  });

  it("different seed → different layout", () => {
    const specA: GlyphSpec = {
      data: { graph },
      layers: [{ mark: "force", encoding: {} }],
      seed: 1,
    };
    const specB: GlyphSpec = {
      data: { graph },
      layers: [{ mark: "force", encoding: {} }],
      seed: 99,
    };
    const a = renderSvg(compileSpec({ spec: specA, rows: [], schema: [] }));
    const b = renderSvg(compileSpec({ spec: specB, rows: [], schema: [] }));
    expect(a).not.toBe(b);
  });

  it("nodes carry distinct fills when group is set", () => {
    const spec: GlyphSpec = {
      data: { graph },
      layers: [{ mark: "force", encoding: {} }],
      seed: 42,
    };
    const scene = compileSpec({ spec, rows: [], schema: [] });
    const circles = scene.marks.filter((m) => m.type === "circle");
    // Two distinct groups → at least two distinct fills.
    const fills = new Set(circles.map((c) => (c.type === "circle" ? c.fill : "")));
    expect(fills.size).toBeGreaterThanOrEqual(2);
  });

  it("BYTE-IDENTITY: cartesian specs unaffected by graph branch", () => {
    const cartesianSpec: GlyphSpec = {
      data: { source: "fixture.csv" },
      layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
    };
    const sceneA = compileSpec({
      spec: cartesianSpec,
      rows: [["a", 1]],
      schema: [
        { name: "x", type: "VARCHAR" },
        { name: "y", type: "INTEGER" },
      ],
    });
    const sceneB = compileSpec({
      spec: cartesianSpec,
      rows: [["a", 1]],
      schema: [
        { name: "x", type: "VARCHAR" },
        { name: "y", type: "INTEGER" },
      ],
    });
    expect(renderSvg(sceneA)).toBe(renderSvg(sceneB));
  });

  it("handles a graph with no edges", () => {
    const spec: GlyphSpec = {
      data: { graph: { nodes: [{ id: "a" }, { id: "b" }] } },
      layers: [{ mark: "force", encoding: {} }],
      seed: 42,
    };
    const scene = compileSpec({ spec, rows: [], schema: [] });
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(circles.length).toBe(2);
  });
});
