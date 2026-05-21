/**
 * Math Phase 2 Track A PR A3 — end-to-end snapshot test for the
 * streamline-saddle fixture.
 *
 * The field is `dx/dt = x, dy/dt = -y` — a classic saddle node at
 * the origin. Integral curves are hyperbolas: `x * y = constant`.
 * Streamlines starting in the right half plane flow rightward and
 * outward; those in the left half plane flow leftward and outward;
 * those near the y-axis flow up or down through the saddle. The
 * pattern reveals the unstable equilibrium at the origin and is
 * the canonical Phase Portrait 101 demo in any dynamical-systems
 * textbook.
 *
 * Determinism gate: same as the rotation fixture — two compiles →
 * byte-identical SVG. The saddle case adds value as a regression
 * guard because (a) the domain-exit termination fires often (most
 * streamlines exit the box rather than loop) and (b) the integrator
 * passes through small dx + small dy regions near the origin where
 * the RK4 stage spacing matters most for byte stability.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./streamline-saddle.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

/** Sentinel rows that pin the x/y scale to the integration domain. */
function buildDomainAnchorRows(): ReadonlyArray<ReadonlyArray<number>> {
  return [
    [-2, -2],
    [2, 2],
  ];
}

const schema: CompileFieldInfo[] = [
  { name: "x", type: "DOUBLE" },
  { name: "y", type: "DOUBLE" },
];

describe("math examples — streamline saddle (Math Track A3)", () => {
  it("renders RK4-integrated streamlines for dx/dt=x, dy/dt=-y deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildDomainAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    // Same input → same output (byte identity).
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // Sanity: 5×5 grid → 25 seeds. Some seeds at the domain edge may
    // hit the boundary on the first step (resulting in a sub-2-point
    // polyline that the compiler skips), so we tolerate a small
    // dropoff but require that the majority render.
    const pathMatches = svg.match(/<path d="M /g) ?? [];
    expect(pathMatches.length).toBeGreaterThanOrEqual(15);
    expect(pathMatches.length).toBeLessThanOrEqual(25);
    // Lock the bytes to a file snapshot.
    await expect(svg).toMatchFileSnapshot("./streamline-saddle.svg");
  });
});
