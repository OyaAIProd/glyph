/**
 * Math PR1 — end-to-end snapshot test for the canonical sine-wave
 * fixture. Parses `sine-wave.json` against the real spec schema,
 * compiles, renders, and locks the SVG bytes to a file snapshot.
 *
 * Determinism gate: two renders of the same fixture must produce the
 * exact same byte string. Any drift (locale, palette, evaluator)
 * shows up as a snapshot diff here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./sine-wave.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — sine wave (math PR1)", () => {
  it("renders y = sin(x) deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Same input → same output (byte identity).
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./sine-wave.svg");
  });
});
