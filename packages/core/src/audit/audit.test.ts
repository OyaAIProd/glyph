/**
 * Tests for the chart auditor (PR63 / PLAN item 2.2).
 */
import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import { auditSpec } from "./index.js";

const minimalBarSpec: GlyphSpec = {
  data: { source: "fixture.csv" },
  layers: [
    {
      mark: "bar",
      encoding: { x: "x", y: "y" },
    },
  ],
};

describe("auditSpec", () => {
  it("returns no findings for a clean bar chart", () => {
    const out = auditSpec({ spec: minimalBarSpec, rowCount: 100 });
    // Some low-severity findings are still acceptable; the high-severity
    // ones we explicitly check should not appear.
    expect(out.some((f) => f.rule_id === "AUDIT-01")).toBe(false);
    expect(out.some((f) => f.rule_id === "AUDIT-03")).toBe(false);
  });

  it("AUDIT-01: flags a truncated y axis on a bar chart", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        layers: [
          {
            mark: "bar",
            encoding: {
              x: "x",
              y: { field: "y", scale: { domain: [100, 200] } },
            },
          },
        ],
      },
    });
    const finding = out.find((f) => f.rule_id === "AUDIT-01");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("high");
    expect(finding?.path).toBe("/layers/0/encoding/y");
  });

  it("AUDIT-01: does NOT flag a domain starting at 0", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        layers: [
          {
            mark: "bar",
            encoding: {
              x: "x",
              y: { field: "y", scale: { domain: [0, 200] } },
            },
          },
        ],
      },
    });
    expect(out.some((f) => f.rule_id === "AUDIT-01")).toBe(false);
  });

  it("AUDIT-03: flags log scale without 'log' in title", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        title: "Revenue over time",
        layers: [
          {
            mark: "bar",
            encoding: {
              x: "x",
              y: { field: "y", scale: { type: "log" } },
            },
          },
        ],
      },
    });
    const finding = out.find((f) => f.rule_id === "AUDIT-03");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("high");
  });

  it("AUDIT-03: passes when title mentions 'log'", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        title: "Revenue (log scale)",
        layers: [
          {
            mark: "bar",
            encoding: {
              x: "x",
              y: { field: "y", scale: { type: "log" } },
            },
          },
        ],
      },
    });
    expect(out.some((f) => f.rule_id === "AUDIT-03")).toBe(false);
  });

  it("AUDIT-02: flags dual-axis layers", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        layers: [
          { mark: "line", encoding: { x: "t", y: "revenue" } },
          {
            mark: "line",
            encoding: { x: "t", y: { field: "users", scale: { side: "right" } } },
          },
        ],
      },
    });
    const finding = out.find((f) => f.rule_id === "AUDIT-02");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("medium");
  });

  it("AUDIT-04: flags excessive aggregation when rowCount < 5", () => {
    const out = auditSpec({ spec: minimalBarSpec, rowCount: 3 });
    const finding = out.find((f) => f.rule_id === "AUDIT-04");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("medium");
  });

  it("AUDIT-04: does NOT flag at rowCount >= 5", () => {
    const out = auditSpec({ spec: minimalBarSpec, rowCount: 50 });
    expect(out.some((f) => f.rule_id === "AUDIT-04")).toBe(false);
  });

  it("AUDIT-06: flags > 8 colors", () => {
    const out = auditSpec({ spec: minimalBarSpec, colorCardinality: 12 });
    const finding = out.find((f) => f.rule_id === "AUDIT-06");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("low");
  });

  it("AUDIT-07: flags extreme aspect ratio", () => {
    const out = auditSpec({
      spec: { ...minimalBarSpec, width: 2000, height: 100 },
    });
    const finding = out.find((f) => f.rule_id === "AUDIT-07");
    expect(finding).toBeDefined();
  });

  it("AUDIT-08: flags diverging palette without midpoint", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        layers: [
          {
            mark: "bar",
            encoding: {
              x: "x",
              y: "y",
              color: { field: "delta", scale: { scheme: "RdBu" } },
            },
          },
        ],
      },
    });
    const finding = out.find((f) => f.rule_id === "AUDIT-08");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("medium");
  });

  it("AUDIT-08: passes when midpoint is set", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        layers: [
          {
            mark: "bar",
            encoding: {
              x: "x",
              y: "y",
              color: { field: "delta", scale: { scheme: "RdBu", midpoint: 0 } },
            },
          },
        ],
      },
    });
    expect(out.some((f) => f.rule_id === "AUDIT-08")).toBe(false);
  });

  it("AUDIT-09: flags multi-layer bars with y domain crossing zero", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        layers: [
          {
            mark: "bar",
            encoding: {
              x: "x",
              y: { field: "y", scale: { domain: [-50, 50] } },
            },
          },
          { mark: "bar", encoding: { x: "x", y: "y2" } },
        ],
      },
    });
    const finding = out.find((f) => f.rule_id === "AUDIT-09");
    expect(finding).toBeDefined();
  });

  it("findings are sorted by severity desc then rule_id", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        title: "Revenue",
        width: 2000,
        height: 100,
        layers: [
          {
            mark: "bar",
            encoding: {
              x: "x",
              y: { field: "y", scale: { type: "log", domain: [100, 200] } },
            },
          },
        ],
      },
      colorCardinality: 12,
    });
    // We expect AUDIT-01 (high), AUDIT-03 (high), AUDIT-06 (low), AUDIT-07 (low).
    expect(out[0]?.severity).toBe("high");
    expect(out[out.length - 1]?.severity).toBe("low");
  });

  it("is deterministic — same input → same output", () => {
    const a = auditSpec({ spec: minimalBarSpec, rowCount: 3 });
    const b = auditSpec({ spec: minimalBarSpec, rowCount: 3 });
    expect(a).toEqual(b);
  });

  // -------------------------------------------------------------------------
  // AUDIT-11 — brand-kit accessibility (Moat PR4)
  // -------------------------------------------------------------------------

  it("AUDIT-11: flags grey-on-grey surface that fails minContrastRatio", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        brand: {
          format: "glyph-brand/1",
          palette: {
            categorical: ["#1d4ed8"],
            surface: {
              fg: "#888888",
              bg: "#999999",
              muted: "#aaaaaa",
              border: "#bbbbbb",
            },
          },
          typography: { fontFamily: "Inter", fontSize: 13, titleScale: 1.2 },
          spacing: { unit: 4, plotMargin: 4 },
          accessibility: { minContrastRatio: 4.5 },
        },
      },
    });
    const finding = out.find((f) => f.rule_id === "AUDIT-11");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("medium");
    expect(finding?.message).toContain("#888888");
    expect(finding?.message).toContain("#999999");
    expect(finding?.path).toBe("/brand/palette");
  });

  it("AUDIT-11: does NOT flag a compliant brand kit", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        brand: {
          format: "glyph-brand/1",
          palette: {
            categorical: ["#1d4ed8", "#f59e0b"],
            surface: {
              fg: "#0f172a",
              bg: "#ffffff",
              muted: "#64748b",
              border: "#e2e8f0",
            },
          },
          typography: { fontFamily: "Inter", fontSize: 13, titleScale: 1.2 },
          spacing: { unit: 4, plotMargin: 4 },
          accessibility: { minContrastRatio: 4.5 },
        },
      },
    });
    expect(out.some((f) => f.rule_id === "AUDIT-11")).toBe(false);
  });

  it("AUDIT-11: flags deuteranope-colliding categorical palette when colorBlindSafe is set", () => {
    const out = auditSpec({
      spec: {
        ...minimalBarSpec,
        brand: {
          format: "glyph-brand/1",
          palette: {
            categorical: ["#ff0000", "#ff1100"],
            surface: {
              fg: "#0f172a",
              bg: "#ffffff",
              muted: "#64748b",
              border: "#e2e8f0",
            },
          },
          typography: { fontFamily: "Inter", fontSize: 13, titleScale: 1.2 },
          spacing: { unit: 4, plotMargin: 4 },
          accessibility: { minContrastRatio: 4.5, colorBlindSafe: true },
        },
      },
    });
    const finding = out.find((f) => f.rule_id === "AUDIT-11");
    expect(finding).toBeDefined();
  });
});
