/**
 * Math Phase 2 Track A PR A1 — end-to-end snapshot test for the
 * canonical damped-oscillator trajectory fixture (`dx/dt = y`,
 * `dy/dt = -x - 0.1*y`).
 *
 * Starting at `(1, 0)` and integrating to `t = 30`, the friction
 * coefficient `0.1` kills the amplitude — the curve should spiral
 * inward toward the origin in phase space. If the snapshot ever
 * renders as a circle (no friction applied), a line segment (RK4
 * regressed), or a tangled zigzag (the parametric-style insertion-
 * order sentinel didn't fire), the regression surfaces immediately
 * via the eyeball check on the SVG.
 *
 * Determinism gate: two renders of the same fixture must produce
 * the exact same byte string. Trajectory inherits the same endpoint
 * anchoring + deterministic evaluator as `sampleFunction` so
 * platform drift across CI runners is impossible.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./damped-oscillator.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("math examples — damped oscillator trajectory (Phase 2 Track A PR A1)", () => {
  it("renders the damped oscillator deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Same input → same output (byte identity).
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./damped-oscillator.svg");
  });
});
