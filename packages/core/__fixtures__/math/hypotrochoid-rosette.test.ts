/**
 * Hypotrochoid — proving the wow page's Spirograph demo (in the
 * "5:3 rosette" preset) IS a Glyph spec.
 *
 * Parametric form:
 *   x(t) = (R−r)·cos(t) + d·cos((R−r)/r · t)
 *   y(t) = (R−r)·sin(t) − d·sin((R−r)/r · t)
 *
 * With R=5, r=3, d=5 this traces a five-petal rosette. The curve
 * closes after lcm(R, r) / r = 5 revolutions in t — so t sweeps
 * [0, 10π] for the trace to come back to its start. 1200 samples
 * gives enough resolution that the petals' inner cusps are
 * rendered without visible chord aliasing.
 *
 * Same `data.shape: "function"` parametric form as the lissajous
 * + butterfly fixtures. No new grammar — just confirming that the
 * entire Spirograph family is already expressible today.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./hypotrochoid-rosette.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — hypotrochoid 5:3 rosette", () => {
  it("renders the rosette deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Sanity: 1200 samples → ~1199 LineTo commands in the single
    // path element.
    const lineToCount = (svg.match(/L /g) ?? []).length;
    expect(lineToCount).toBeGreaterThan(1100);
    await expect(svg).toMatchFileSnapshot("./hypotrochoid-rosette.svg");
  });
});
