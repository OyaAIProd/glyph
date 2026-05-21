/**
 * Math Phase 2 Track A PR A1 — end-to-end snapshot test for the
 * Lotka-Volterra predator-prey trajectory fixture. With the rate
 * coefficients `α = 1.1`, `β = 0.4`, `γ = 1.5`, `δ = 0.1` and
 * initial populations `(prey, predator) = (10, 5)`, the system
 * traces a closed limit cycle in phase space — the cycle is the
 * recognizable "wave around an equilibrium point" of the canonical
 * Lotka-Volterra model.
 *
 * This fixture is the load-bearing test for the insertion-order
 * sentinel: the orbit revisits the same x values, so if the line
 * mark sorted by x the snapshot would render as a zigzag instead of
 * a closed loop (exactly the failure mode that broke Lissajous in
 * Math PR5). The trajectory sentinel borrows the parametric-data
 * trick to disable that sort.
 *
 * Determinism gate: two renders of the same fixture must produce
 * the exact same byte string.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./predator-prey.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — Lotka-Volterra predator-prey (Phase 2 Track A PR A1)", () => {
  it("renders the Lotka-Volterra limit cycle deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Same input → same output (byte identity).
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./predator-prey.svg");
  });
});
