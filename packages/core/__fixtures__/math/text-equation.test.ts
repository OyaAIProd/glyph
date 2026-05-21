/**
 * Math PR4 — end-to-end snapshot test for the canonical math-text
 * fixture.
 *
 * The spec renders a sine curve (sampled via `data.function`) and
 * overlays the LaTeX label `y = \sin(x)` at (x=0, y=1.15), just above
 * the curve's peak. The math-text mark compiles KaTeX MathML into a
 * positioned bundle of `<text>` SceneMarks (one per glyph); no fonts
 * or client-side JS are required at render time.
 *
 * Determinism gate: two renders of the same fixture must produce the
 * exact same byte string. KaTeX's MathML output is stable across
 * versions within a major (we pin ^0.16); the layout metrics are a
 * hardcoded table indexed by codepoint, so no platform drift can leak
 * into glyph positions.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./text-equation.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — math-text label (math PR4)", () => {
  it("renders the y = sin(x) annotation deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Same input → same output (byte identity).
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Sanity: the LaTeX `y = \sin(x)` lowers to MathML with at least
    // 7 visible glyphs (y, =, s, i, n, (, x, )). Each glyph emits one
    // `<text>` SceneMark; the polyline for the sine curve is one
    // `<path>` element. So we expect plenty of `<text>` nodes.
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(svg).toContain("sin");
    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./text-equation.svg");
  });
});
