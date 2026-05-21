/**
 * Math Phase 2 Track A PR A5 — end-to-end snapshot test for the
 * `bezier-cubic` fixture.
 *
 * The fixture is a degree-3 (cubic) Bezier curve with four control
 * points, `showControls: true`, and a de Casteljau construction
 * overlay at `t = 0.5`. The expected visual is:
 *   - one continuous curve (the sampled cubic)
 *   - a dashed control polygon connecting the 4 control points
 *   - 4 small filled circles at the control points
 *   - per-level de Casteljau construction polylines (levels 1 and 2)
 *     at `t = 0.5`, plus a marker at the curve sample (the midpoint
 *     of the level-2 line, which IS the curve point at t).
 *
 * Determinism gate: two renders of the same fixture must produce the
 * exact same byte string. de Casteljau is a pure linear interpolation
 * tree; every projected pixel runs through `roundPx`; same input →
 * same SVG bytes on every platform.
 *
 * The bezier mark draws no row-derived data — `bezier.controlPoints`
 * lives in the layer config, not in the `rows` array — but the
 * compiler still requires `x`/`y` encodings to resolve scales. We
 * anchor the scale domain via corner sentinel rows that match the
 * fixture's `[0, 10]` extents.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./bezier-cubic.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

/**
 * Sentinel rows anchoring the x/y scale to the [0, 10] domain the
 * fixture specifies. The bezier compiler does NOT consume these rows
 * (control points live in the layer config), but the resolved linear
 * scale uses them to project the control-point pixels.
 */
function buildDomainAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [0, 0],
    [10, 10],
  ];
}

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

describe("math examples — bezier cubic with de Casteljau (Math Track A5)", () => {
  it("renders a cubic Bezier curve with construction overlay deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildDomainAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    // Same input → same output (byte identity). Mirrors the
    // trajectory / function / streamline determinism contracts.
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // Sanity: the SVG should contain at least one <path> (the curve
    // itself). showControls + showConstruction emit additional paths
    // (control polygon + per-level construction lines), so we expect
    // multiple. We assert ≥ 3 to be tolerant of how the construction
    // levels are emitted (could be 1 polyline per level or merged).
    const pathMatches = svg.match(/<path d="M /g) ?? [];
    expect(pathMatches.length).toBeGreaterThanOrEqual(3);
    // Sanity: control-point markers — 4 small filled circles for a
    // cubic.
    const circleMatches = svg.match(/<circle /g) ?? [];
    expect(circleMatches.length).toBeGreaterThanOrEqual(4);
    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./bezier-cubic.svg");
  });
});
