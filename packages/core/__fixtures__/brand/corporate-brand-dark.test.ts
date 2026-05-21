/**
 * Moat PR4 — dark-mode variant of the corporate brand kit. Same spec
 * shape as `corporate-brand.json` with only `palette.surface` swapped.
 *
 * Verifies the headline composition story: a single brand kit, two
 * surface blocks → two visibly distinct chart renders, no other spec
 * changes required.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditSpec } from "../../src/audit/index.js";
import { compileSpec } from "../../src/compiler/compile.js";
import { renderSvg } from "../../src/render/svg.js";
import { parseSpec } from "../../src/spec/parse.js";

const darkUrl = new URL("./corporate-brand-dark.json", import.meta.url);
const darkPath = fileURLToPath(darkUrl);
const lightUrl = new URL("./corporate-brand.json", import.meta.url);
const lightPath = fileURLToPath(lightUrl);

describe("brand examples — corporate-brand-dark (moat PR4)", () => {
  it("renders the dark variant deterministically and locks the SVG bytes", async () => {
    const raw = JSON.parse(readFileSync(darkPath, "utf8"));
    const spec = parseSpec(raw);
    const svg = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    const svg2 = renderSvg(compileSpec({ spec, rows: [], schema: [] }));
    expect(svg2).toBe(svg);
    await expect(svg).toMatchFileSnapshot("./corporate-brand-dark.svg");
  });

  it("renders distinctly from the light variant — single brand, surface swap only", () => {
    const lightSpec = parseSpec(JSON.parse(readFileSync(lightPath, "utf8")));
    const darkSpec = parseSpec(JSON.parse(readFileSync(darkPath, "utf8")));
    const lightSvg = renderSvg(compileSpec({ spec: lightSpec, rows: [], schema: [] }));
    const darkSvg = renderSvg(compileSpec({ spec: darkSpec, rows: [], schema: [] }));
    expect(lightSvg).not.toBe(darkSvg);
    // The categorical palette is shared — the dark surface tokens
    // appear in the dark render and the light surface tokens appear
    // in the light render. Spot-check both.
    expect(darkSvg).toContain("#0b1220");
    expect(lightSvg).toContain("#ffffff");
  });

  it("AUDIT-11 stays silent on a compliant dark brand", () => {
    const raw = JSON.parse(readFileSync(darkPath, "utf8"));
    const spec = parseSpec(raw);
    const findings = auditSpec({ spec });
    expect(findings.some((f) => f.rule_id === "AUDIT-11")).toBe(false);
  });
});
