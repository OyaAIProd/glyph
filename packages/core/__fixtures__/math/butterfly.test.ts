/**
 * Butterfly curve (Temple H. Fay, 1989) — proving the wow page's
 * butterfly demo IS a Glyph spec.
 *
 * The curve is the parametric trace of:
 *   x(t) = sin(t) · (exp(cos t) − 2 cos(4t) − sin⁵(t/12))
 *   y(t) = cos(t) · (exp(cos t) − 2 cos(4t) − sin⁵(t/12))
 * over t ∈ [0, 12π]. With 1500 samples that's enough resolution to
 * see all six wings without aliasing.
 *
 * The `^` / `**` power operator isn't supported by the default
 * expr-eval evaluator we ship — so `sin(t/12)^5` is expanded to
 * five chained multiplications. Verbose but unambiguous; this is
 * the canonical way agents will author "sin^n" until/unless the
 * evaluator gains a pow shorthand.
 *
 * Determinism is locked the same way every other math fixture is —
 * byte-identical SVG across runs and platforms.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./butterfly.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — butterfly curve (Temple Fay)", () => {
  it("renders the six-winged butterfly deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Sanity: the trace is a single connected path with ~1500
    // line-to commands (one per sample after the initial M).
    const lineToCount = (svg.match(/L /g) ?? []).length;
    expect(lineToCount).toBeGreaterThan(1400);
    await expect(svg).toMatchFileSnapshot("./butterfly.svg");
  });
});
