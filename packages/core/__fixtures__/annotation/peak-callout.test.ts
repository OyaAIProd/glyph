/**
 * Joy of Math PR E1 — end-to-end snapshot test for the canonical
 * annotation fixture.
 *
 * The spec layers a sine curve sampled across [-2π, 2π] with an
 * annotation callout pinned at the data-space point (π/2, 1) — the
 * peak of sin(x). The compiler resolves the coord-mode anchor, picks
 * the "auto" arrow direction (down-left, since π/2 sits in the
 * upper-right quadrant of the plot area), and emits the highlight
 * ring + arrow + bubble + text marks.
 *
 * Determinism gate: two renders of the same fixture must produce the
 * exact same byte string. Anchor projection runs through the existing
 * `roundPx` rounding; quadrant selection compares against the
 * deterministic plot-area center.
 *
 * Visual gates (sanity, not byte-exact): the snapshot must contain
 *   - the reused `<marker id="glyph-arrow">` from vector-field,
 *   - a `marker-end="url(#glyph-arrow)"` reference,
 *   - the `peak!` label as text content.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./peak-callout.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("annotation examples — peak-callout (joy PR E1)", () => {
  it("renders the sine-curve peak annotation deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Same input → same output (byte identity).
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Sanity: the annotation rides the existing arrow marker + emits
    // the "peak!" label.
    expect(svg).toContain('id="glyph-arrow"');
    expect(svg).toContain('marker-end="url(#glyph-arrow)"');
    expect(svg).toContain("peak!");
    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./peak-callout.svg");
  });
});
