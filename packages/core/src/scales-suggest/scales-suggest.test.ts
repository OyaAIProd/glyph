/**
 * Tests for the scale-tuning suggestion module (PR60 item 2.6).
 */
import { describe, expect, it } from "vitest";
import { suggestScale } from "./index.js";

const numericSchema = [
  { name: "x", type: "INTEGER", suggested: "ordinal" as const },
  { name: "y", type: "DOUBLE", suggested: "quantitative" as const },
];

describe("suggestScale", () => {
  it("suggests log for distributions spanning > 100×", () => {
    // $100 → $10M revenue range.
    const rows = [
      [1, 100],
      [2, 500],
      [3, 50_000],
      [4, 2_500_000],
      [5, 10_000_000],
    ];
    const out = suggestScale({ schema: numericSchema, rows, field: "y" });
    expect(out.length).toBe(1);
    expect(out[0]?.kind).toBe("log");
    expect(out[0]?.field).toBe("y");
    expect(out[0]?.confidence).toBeGreaterThan(0.7);
    expect(out[0]?.reason).toMatch(/log/);
  });

  it("suggests diverging for sign-crossing values around zero", () => {
    const rows = [
      [1, -40],
      [2, -25],
      [3, -10],
      [4, 5],
      [5, 30],
      [6, 50],
    ];
    const out = suggestScale({ schema: numericSchema, rows, field: "y" });
    expect(out[0]?.kind).toBe("diverging");
    expect(out[0]?.reason).toMatch(/zero/i);
  });

  it("suggests sqrt for long-tailed (high skewness) distributions", () => {
    // Heavily right-skewed: many small + a few huge.
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 1],
      [5, 1],
      [6, 1],
      [7, 100],
      [8, 1],
      [9, 1],
      [10, 1],
    ];
    const out = suggestScale({ schema: numericSchema, rows, field: "y" });
    // Could be log or sqrt — both are valid for this shape. Check that the
    // suggestion fires at all.
    expect(out.length).toBeGreaterThan(0);
    expect(["log", "sqrt"].includes(out[0]?.kind ?? "")).toBe(true);
  });

  it("returns 'none' for tightly-clustered data", () => {
    const rows = [
      [1, 100],
      [2, 102],
      [3, 99],
      [4, 101],
      [5, 100],
      [6, 100.5],
    ];
    const out = suggestScale({ schema: numericSchema, rows, field: "y" });
    // Tight cluster — either no suggestion or a "none" sentinel.
    if (out.length > 0) expect(out[0]?.kind).toBe("none");
  });

  it("considers every quantitative column when no field is passed", () => {
    const schema = [
      { name: "a", type: "DOUBLE", suggested: "quantitative" as const },
      { name: "b", type: "DOUBLE", suggested: "quantitative" as const },
      { name: "c", type: "VARCHAR", suggested: "nominal" as const },
    ];
    const rows = [
      [1, 100, "x"],
      [10_000, 200, "y"],
      [1_000_000, 300, "z"],
      [50_000_000, 400, "w"],
    ];
    const out = suggestScale({ schema, rows });
    // Column a (wide ratio) should suggest log; b (tight) maybe none.
    expect(out.some((s) => s.field === "a" && s.kind === "log")).toBe(true);
    // Categorical column c is skipped.
    expect(out.some((s) => s.field === "c")).toBe(false);
  });

  it("is deterministic — same input → same output", () => {
    const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [1, 100],
      [2, 50_000],
      [3, 10_000_000],
    ];
    const a = suggestScale({ schema: numericSchema, rows });
    const b = suggestScale({ schema: numericSchema, rows });
    expect(a).toEqual(b);
  });
});
