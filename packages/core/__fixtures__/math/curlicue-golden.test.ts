/**
 * RFC 2026-05-22 — end-to-end fixture for `data.shape: "recurrence"`.
 *
 * The wow page's curlicue demo expressed as a Glyph spec. The
 * recurrence walks
 *     z_{n+1} = z_n + e^{i · θ · n²}
 * for 4000 steps at the golden angle θ ≈ 2.39996 rad. The resulting
 * (x, y) lattice IS the canonical sunflower-seed pattern.
 *
 * This fixture is the proof that the wow page's "iterative
 * recurrence" regime is now a first-class Glyph spec. Byte-identity
 * locked in CI by `toMatchFileSnapshot` — same recurrence renders
 * the same SVG bytes on every platform.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./curlicue-golden.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — curlicue golden-angle recurrence (RFC 2026-05-22)", () => {
  it("renders the golden-angle curlicue deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // 4000 steps → ~3999 LineTo commands on the single path. (n=0
    // is the M anchor; n=1..3999 are L segments.)
    const lineToCount = (svg.match(/L /g) ?? []).length;
    expect(lineToCount).toBeGreaterThan(3900);
    await expect(svg).toMatchFileSnapshot("./curlicue-golden.svg");
  });
});
