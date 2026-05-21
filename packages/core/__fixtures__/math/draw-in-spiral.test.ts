/**
 * Math Phase 2 Track A2 — end-to-end snapshot test for the draw-in
 * spiral fixture. Parses `draw-in-spiral.json` against the real spec
 * schema, compiles, renders, asserts byte-stability across re-renders,
 * and locks the SVG bytes to a file snapshot.
 *
 * The fixture is an Archimedean-style spiral:
 *   x = t·cos(t)/8,  y = t·sin(t)/8,  t ∈ [0, 25],  200 samples.
 * Drawn with the pen-draw animation:
 *   animation.kind: "draw-in", duration_ms: 3000, easing: "ease-in-out".
 *
 * Determinism gate: two renders of the same fixture produce byte-identical
 * SVGs. The polyline-length helper is rounded to 8 decimals via roundPx,
 * so the SMIL animate values are stable across platforms.
 *
 * Functional gate: the rendered SVG contains
 * `<animate attributeName="stroke-dashoffset"` — proves the renderer
 * actually emitted the pen-draw markup for the path mark.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./draw-in-spiral.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — draw-in spiral (Phase 2 Track A2)", () => {
  it("renders the spiral with a SMIL pen-draw animation, byte-stably", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Determinism: same spec → same bytes across re-renders.
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Functional check: the SMIL <animate> element is actually present.
    expect(svg).toContain('<animate attributeName="stroke-dashoffset"');
    expect(svg).toContain('dur="3000ms"');
    expect(svg).toContain('fill="freeze"');
    // ease-in-out emits keyTimes + keySplines.
    expect(svg).toContain("keySplines");
    // The path itself carries the dash attributes that hide the line
    // until the animate ramps the offset to zero.
    expect(svg).toContain("stroke-dasharray=");
    expect(svg).toContain("stroke-dashoffset=");
    // Class marker on the marks group lets CSS / observers target it.
    expect(svg).toContain("glyph-draw-in");
    // Lock the bytes.
    await expect(svg).toMatchFileSnapshot("./draw-in-spiral.svg");
  });
});
