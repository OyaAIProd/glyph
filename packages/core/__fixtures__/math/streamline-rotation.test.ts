/**
 * Math Phase 2 Track A PR A3 — end-to-end snapshot test for the
 * streamline-rotation fixture.
 *
 * The field is `dx/dt = -y, dy/dt = x` (a pure rotation about the
 * origin) — identical to the vector-field-rotation fixture's field,
 * but rendered as continuous streamlines via RK4 integration instead
 * of discrete arrows. The expected visual is a set of concentric-ish
 * circles around the origin: integral curves of a rotation field are
 * circles, so the integration reveals the global flow structure that
 * arrows can only hint at.
 *
 * Determinism gate: two renders of the same fixture must produce the
 * exact same byte string. RK4 + `roundPx` + IEEE-754 sin/cos give the
 * same step bytes on every platform; same evaluator + same scope →
 * byte-identity contract carries over from the trajectory / function
 * shapes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type CompileFieldInfo, compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./streamline-rotation.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

/**
 * Sentinel rows anchoring the x/y scale to the [-2, 2] integration
 * domain. The compiler's linear-scale resolver derives extents from
 * `rows` (it doesn't currently honor `encoding.scale.domain` on the
 * linear path), so we pin the corners explicitly. The streamline
 * compiler itself does NOT read these rows — it reads `streamline.*`
 * from the layer — but the resolved scale is what maps integrated
 * (x, y) data values to pixel coordinates.
 */
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

describe("math examples — streamline rotation (Math Track A3)", () => {
  it("renders RK4-integrated streamlines for dx/dt=-y, dy/dt=x deterministically", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const rows = buildDomainAnchorRows();
    const svg = renderSvg(compileSpec({ spec, rows, schema }));
    // Same input → same output (byte identity). Mirrors the
    // trajectory / function determinism contracts.
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    // Sanity: 5×5 grid → 25 seeds → 25 streamline <path> tags. Each
    // streamline is one path; loop-detection or domain exit may
    // truncate but never split into multiple paths.
    const pathMatches = svg.match(/<path d="M /g) ?? [];
    expect(pathMatches.length).toBeGreaterThanOrEqual(20);
    expect(pathMatches.length).toBeLessThanOrEqual(25);
    // Lock the bytes to a file snapshot — any drift surfaces as a diff.
    await expect(svg).toMatchFileSnapshot("./streamline-rotation.svg");
  });
});
