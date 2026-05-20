/**
 * Math PR3 — end-to-end snapshot test for the canonical vector-field
 * rotation fixture.
 *
 * The field is `(dx, dy) = (-y, x)` (a pure rotation about the origin)
 * sampled on a 5×5 grid from -2 to 2. The compiler emits one arrow
 * SceneMark per row; the SVG renderer emits a `<line>` per arrow plus
 * a single `<defs><marker>` for the arrowhead.
 *
 * Determinism gate: two renders of the same fixture must produce the
 * exact same byte string. `atan2(dy, dx)` is IEEE-754 stable so the
 * angle field is platform-independent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./vector-field-rotation.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

/** Build the 5×5 rotation field rows in row-major order. */
function buildRotationRows(): ReadonlyArray<ReadonlyArray<number>> {
  const rows: number[][] = [];
  for (let yi = -2; yi <= 2; yi++) {
    for (let xi = -2; xi <= 2; xi++) {
      // (dx, dy) = (-y, x) — a pure rotation. The mark compiler flips
      // dy at the renderer to match screen-space y-down conventions.
      rows.push([xi, yi, -yi, xi]);
    }
  }
  return rows;
}

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
  { name: "dx", type: "DOUBLE" },
  { name: "dy", type: "DOUBLE" },
];

describe("math examples — vector-field rotation (math PR3)", () => {
  it("renders the rotation field (-y, x) deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildRotationRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    // Same input → same output (byte identity).
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // Sanity: 25 grid points → 24 arrows (the origin row has zero
    // magnitude → length-4 arrow; still emitted) and one marker def.
    expect((svg.match(/<line /g) ?? []).length).toBeGreaterThanOrEqual(25);
    expect(svg).toContain('id="glyph-arrow"');
    expect(svg).toContain('marker-end="url(#glyph-arrow)"');
    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./vector-field-rotation.svg");
  });
});
