/**
 * Moat PR3 — interpolate-rendered fixture: line chart with two interior
 * gaps; `onMissing: "interpolate"` linearly bridges them with a dashed
 * stroke segment. Locks the SVG bytes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";
import type { ColumnInfo } from "../../src/compute/engine.js";

const fixtureUrl = new URL("./interpolate-rendered.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

const schema: ColumnInfo[] = [
  { name: "t", type: "DOUBLE", nullable: false },
  { name: "value", type: "DOUBLE", nullable: true },
];

// 10 sampled points; two interior gaps (indices 3 and 7).
const rows: Array<Array<number | null>> = [
  [0, 10],
  [1, 20],
  [2, 30],
  [3, null],
  [4, 50],
  [5, 60],
  [6, 70],
  [7, null],
  [8, 88],
  [9, 95],
];

describe("moat PR3 — interpolate-rendered fixture", () => {
  it("emits a solid sub-path and a dashed bridge segment", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const scene = compileSpec({ spec, rows, schema });
    const paths = scene.marks.filter((m) => m.type === "path");
    // Expect at least one solid + one dashed sub-path.
    const solid = paths.filter((p) => p.strokeDasharray === undefined);
    const dashed = paths.filter((p) => p.strokeDasharray !== undefined);
    expect(solid.length).toBeGreaterThan(0);
    expect(dashed.length).toBeGreaterThan(0);
    // Determinism + byte snapshot.
    const svg = renderSvg(scene);
    const svg2 = renderSvg(compileSpec({ spec, rows, schema }));
    expect(svg2).toBe(svg);
    expect(svg).toContain('stroke-dasharray="4 4"');
    await expect(svg).toMatchFileSnapshot("./interpolate-rendered.svg");
  });
});
