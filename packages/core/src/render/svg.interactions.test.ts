/**
 * Tests for declarative interaction-flag rendering (PR77 / D3 Gap 8).
 * Verifies that spec.interactive.{zoomable, lassoable, voronoi} flags
 * round-trip into the SVG root as data-glyph-* attributes that
 * @glyph/live can hydrate on.
 *
 * Determinism: same flags → same SVG bytes. When flags are unset,
 * the root carries none of these attrs (byte-identity for existing
 * snapshots).
 */
import { describe, expect, it } from "vitest";
import { compileSpec } from "../compiler/compile.js";
import type { GlyphSpec } from "../spec/types.js";
import { renderSvg } from "./svg.js";

const baseSpec: GlyphSpec = {
  data: { source: "fixture.csv" },
  layers: [{ mark: "bar", encoding: { x: "x", y: "y" } }],
};
const rows = [
  ["a", 1],
  ["b", 2],
];
const schema = [
  { name: "x", type: "VARCHAR" },
  { name: "y", type: "INTEGER" },
];

describe("renderSvg — declarative interaction flags (PR77)", () => {
  it("zoomable=true emits data-glyph-zoom on the SVG root", () => {
    const spec: GlyphSpec = {
      ...baseSpec,
      interactive: { zoomable: true },
    };
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg).toContain('data-glyph-zoom="true"');
  });

  it("lassoable=true emits data-glyph-lasso on the SVG root", () => {
    const spec: GlyphSpec = {
      ...baseSpec,
      interactive: { lassoable: true },
    };
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg).toContain('data-glyph-lasso="true"');
  });

  it("voronoi=true emits data-glyph-voronoi on the SVG root", () => {
    const spec: GlyphSpec = {
      ...baseSpec,
      interactive: { voronoi: true },
    };
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg).toContain('data-glyph-voronoi="true"');
  });

  it("combined flags coexist", () => {
    const spec: GlyphSpec = {
      ...baseSpec,
      interactive: { zoomable: true, lassoable: true, voronoi: true },
    };
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg).toContain('data-glyph-zoom="true"');
    expect(svg).toContain('data-glyph-lasso="true"');
    expect(svg).toContain('data-glyph-voronoi="true"');
  });

  it("BYTE-IDENTITY: a spec without any interaction flags carries none of the attrs", () => {
    // The spec has no `interactive` block → no schema → no data-glyph-* attrs.
    const svg = renderSvg(compileSpec({ spec: baseSpec, rows, schema }));
    expect(svg).not.toContain("data-glyph-zoom");
    expect(svg).not.toContain("data-glyph-lasso");
    expect(svg).not.toContain("data-glyph-voronoi");
  });

  it("interactive={} (only hover) does NOT spuriously emit interaction attrs", () => {
    const spec: GlyphSpec = {
      ...baseSpec,
      interactive: {}, // present, but no zoomable/lassoable/voronoi
    };
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg).not.toContain("data-glyph-zoom");
    expect(svg).not.toContain("data-glyph-lasso");
    expect(svg).not.toContain("data-glyph-voronoi");
  });
});
