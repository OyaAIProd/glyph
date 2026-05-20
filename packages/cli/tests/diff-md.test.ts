/**
 * Tests for `glyph diff <a.json> <b.json> --format md --image-dir <dir>`
 * — the S4 / "Chart Audit on PR" entry point added in PR0.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeTrustScore, runDiffCommand } from "../src/commands/diff.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const specBefore = join(fixturesDir, "spec-before.json");
const specAfter = join(fixturesDir, "spec-after.json");

describe("glyph diff --format md", () => {
  let imageDir: string;
  beforeEach(() => {
    imageDir = mkdtempSync(join(tmpdir(), "glyph-diff-md-"));
  });
  afterEach(() => {
    rmSync(imageDir, { recursive: true, force: true });
  });

  it("produces markdown with diff + audit + trust + image refs", async () => {
    const result = await runDiffCommand({
      a: specBefore,
      b: specAfter,
      format: "md",
      imageDir,
    });
    expect(result.markdown).toMatch(/^## Glyph chart change$/m);
    expect(result.markdown).toMatch(/^### Diff$/m);
    expect(result.markdown).toContain("```diff");
    expect(result.markdown).toMatch(/^### Audit$/m);
    expect(result.markdown).toMatch(/^trust:\s+\d+\s*\/\s*100$/m);
    expect(result.markdown).toMatch(/^### Render$/m);
    expect(result.imagesGenerated).toEqual(expect.arrayContaining(["before.svg", "after.svg"]));
  });

  it("writes both SVGs to disk under imageDir", async () => {
    await runDiffCommand({
      a: specBefore,
      b: specAfter,
      format: "md",
      imageDir,
    });
    const beforeSvg = join(imageDir, "before.svg");
    const afterSvg = join(imageDir, "after.svg");
    expect(existsSync(beforeSvg)).toBe(true);
    expect(existsSync(afterSvg)).toBe(true);
    // Sanity-check: each file is non-empty SVG markup.
    expect(statSync(beforeSvg).size).toBeGreaterThan(0);
    expect(readFileSync(beforeSvg, "utf8")).toContain("<svg");
    expect(readFileSync(afterSvg, "utf8")).toContain("<svg");
  });

  it("surfaces the AUDIT-01 (truncated y) finding from the after spec", async () => {
    // The after-fixture introduces scale.domain = [100, 160] on a bar chart.
    // AUDIT-01 must flag that — high severity, mapped to ✗ in the markdown.
    const result = await runDiffCommand({
      a: specBefore,
      b: specAfter,
      format: "md",
      imageDir,
    });
    expect(result.markdown).toContain("AUDIT-01");
    expect(result.markdown).toContain("✗");
  });

  it("emits the structural diff block with -/+ lines", async () => {
    const result = await runDiffCommand({
      a: specBefore,
      b: specAfter,
      format: "md",
      imageDir,
    });
    // The before spec had `"y": "revenue"` (a shorthand string); the after
    // spec replaces it with an object — so we expect a changed-value line in
    // the diff block.
    const diffBlockMatch = result.markdown.match(/```diff\n([\s\S]*?)```/);
    expect(diffBlockMatch).not.toBeNull();
    const body = diffBlockMatch?.[1] ?? "";
    expect(body).toMatch(/^[-+]/m);
  });

  it("exit code is 1 when specs differ, 0 when identical", async () => {
    const diff = await runDiffCommand({
      a: specBefore,
      b: specAfter,
      format: "md",
      imageDir,
    });
    expect(diff.exitCode).toBe(1);
    const same = await runDiffCommand({
      a: specBefore,
      b: specBefore,
      format: "md",
      imageDir,
    });
    expect(same.exitCode).toBe(0);
  });
});

describe("computeTrustScore", () => {
  it("returns 100 for no findings", () => {
    expect(computeTrustScore([])).toBe(100);
  });

  it("subtracts severity weights and clamps to [0, 100]", () => {
    // 1 high (-15) + 1 medium (-7) + 1 low (-3) = 75.
    const score = computeTrustScore([
      { rule_id: "X-HIGH", severity: "high", message: "m" },
      { rule_id: "X-MED", severity: "medium", message: "m" },
      { rule_id: "X-LOW", severity: "low", message: "m" },
    ]);
    expect(score).toBe(75);
  });

  it("floors at 0 for very noisy specs", () => {
    const score = computeTrustScore(
      new Array(20).fill(null).map((_, i) => ({
        rule_id: `X-${i}`,
        severity: "high" as const,
        message: "m",
      })),
    );
    expect(score).toBe(0);
  });
});
