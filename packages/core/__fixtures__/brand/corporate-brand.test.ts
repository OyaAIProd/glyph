/**
 * Moat PR4 — end-to-end snapshot test for the canonical corporate
 * brand kit fixture. Parses `corporate-brand.json` against the real
 * spec schema, compiles, renders, and locks the SVG bytes to a file
 * snapshot.
 *
 * Demonstrates the headline composition trick: this fixture and the
 * `corporate-brand-dark.json` neighbor differ only in the
 * `palette.surface` block, yet render to visibly distinct SVGs.
 *
 * Also asserts that AUDIT-11 stays silent on a compliant brand kit.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditSpec } from "../../src/audit/index.js";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const fixtureUrl = new URL("./corporate-brand.json", import.meta.url);
const fixturePath = fileURLToPath(fixtureUrl);

describe("brand examples — corporate-brand (moat PR4)", () => {
  it("renders the corporate brand deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    // Determinism: same input → byte-identical output.
    expect(svg2).toBe(svg);
    await expect(svg).toMatchFileSnapshot("./corporate-brand.svg");
  });

  it("AUDIT-11 stays silent on a compliant corporate brand", () => {
    const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
    const spec = parseSpec(raw);
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-11")).toBe(false);
  });
});
