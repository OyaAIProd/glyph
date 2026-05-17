/**
 * Tests for the spec-diff module (PR60 item 1.7).
 */
import { describe, expect, it } from "vitest";
import { diffSpecs } from "./index.js";

describe("diffSpecs", () => {
  it("returns empty diff for identical specs", () => {
    const a = { layers: [{ mark: "bar" }], data: { source: "sales" } };
    const b = { layers: [{ mark: "bar" }], data: { source: "sales" } };
    const d = diffSpecs(a, b);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(d.summary).toBe("");
  });

  it("detects an added layer", () => {
    const a = { layers: [{ mark: "bar" }] };
    const b = { layers: [{ mark: "bar" }, { mark: "line" }] };
    const d = diffSpecs(a, b);
    expect(d.added.some((x) => x.path === "/layers/1")).toBe(true);
    expect(d.summary).toMatch(/1 layer\(s\) added/);
  });

  it("detects a removed layer", () => {
    const a = { layers: [{ mark: "bar" }, { mark: "line" }] };
    const b = { layers: [{ mark: "bar" }] };
    const d = diffSpecs(a, b);
    expect(d.removed.some((x) => x.path === "/layers/1")).toBe(true);
    expect(d.summary).toMatch(/1 layer\(s\) removed/);
  });

  it("detects an encoding field change", () => {
    const a = { layers: [{ encoding: { x: { field: "year" } } }] };
    const b = { layers: [{ encoding: { x: { field: "month" } } }] };
    const d = diffSpecs(a, b);
    expect(d.changed.length).toBeGreaterThan(0);
    const ch = d.changed.find((c) => c.path.includes("/encoding/"));
    expect(ch).toBeDefined();
    expect(ch?.before).toBe("year");
    expect(ch?.after).toBe("month");
    expect(d.summary).toMatch(/encoding/);
  });

  it("calls out data.transform changes in the summary", () => {
    const a = {
      data: { source: "sales", transform: "SELECT * FROM sales" },
    };
    const b = {
      data: { source: "sales", transform: "SELECT * FROM sales WHERE year=2024" },
    };
    const d = diffSpecs(a, b);
    expect(d.summary).toMatch(/data\.transform/);
  });

  it("calls out data.source changes in the summary", () => {
    const a = { data: { source: "sales" } };
    const b = { data: { source: "marketing" } };
    const d = diffSpecs(a, b);
    expect(d.summary).toMatch(/source/);
    expect(d.summary).toMatch(/sales/);
    expect(d.summary).toMatch(/marketing/);
  });

  it("handles deeply nested encoding rewrites", () => {
    const a = {
      layers: [
        {
          encoding: {
            x: { field: "year", type: "ordinal" },
            y: { field: "revenue", type: "quantitative" },
          },
        },
      ],
    };
    const b = {
      layers: [
        {
          encoding: {
            x: { field: "year", type: "ordinal" },
            y: { field: "profit", type: "quantitative" },
          },
        },
      ],
    };
    const d = diffSpecs(a, b);
    const fieldChange = d.changed.find((c) => c.path.endsWith("/field"));
    expect(fieldChange?.before).toBe("revenue");
    expect(fieldChange?.after).toBe("profit");
  });

  it("escapes RFC 6901 reserved characters in JSON pointers", () => {
    const a = { "a/b": 1, "c~d": 2 };
    const b = { "a/b": 99, "c~d": 2 };
    const d = diffSpecs(a, b);
    // / → ~1, ~ → ~0 per RFC 6901.
    expect(d.changed.some((c) => c.path === "/a~1b")).toBe(true);
  });

  it("is deterministic — same inputs → same output", () => {
    const a = { layers: [{ mark: "bar" }], data: { source: "x" } };
    const b = { layers: [{ mark: "line" }], data: { source: "y" } };
    const d1 = diffSpecs(a, b);
    const d2 = diffSpecs(a, b);
    expect(d1).toEqual(d2);
  });
});
