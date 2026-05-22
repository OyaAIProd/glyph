import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "../compute/engine.js";
import type { GlyphSpec } from "../spec/types.js";
import { compileSpec } from "./compile.js";

const schema: ColumnInfo[] = [
  { name: "hour", type: "INTEGER", nullable: false },
  { name: "rides", type: "INTEGER", nullable: false },
];

const rows: number[][] = [
  [0, 10],
  [1, 20],
  [2, 30],
];

describe("compileSpec — bar", () => {
  it("produces one rect per row with band x and quantitative y", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const rects = scene.marks.filter((m) => m.type === "rect");
    expect(rects).toHaveLength(3);
    expect(scene.axes).toHaveLength(2);
    expect(scene.axes.some((a) => a.orientation === "bottom")).toBe(true);
    expect(scene.axes.some((a) => a.orientation === "left")).toBe(true);
  });

  it("respects custom width/height", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      width: 800,
      height: 500,
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.width).toBe(800);
    expect(scene.height).toBe(500);
  });

  it("uses dark theme background when requested", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      theme: "dark",
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.background).toBe("#0e0e10");
  });

  it("places the title in the scene", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
      title: "Hello",
    };
    const scene = compileSpec({ spec, rows, schema });
    expect(scene.title).toBe("Hello");
  });
});

describe("compileSpec — point", () => {
  it("produces one circle per row with linear x", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "point", encoding: { x: "hour", y: "rides" } }],
    };
    const scene = compileSpec({ spec, rows, schema });
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(circles).toHaveLength(3);
  });

  it("applies colors from a fixed palette when color channel is set", () => {
    const colorSchema: ColumnInfo[] = [
      ...schema,
      { name: "kind", type: "VARCHAR", nullable: true },
    ];
    const colorRows: Array<Array<number | string>> = [
      [0, 10, "a"],
      [1, 20, "b"],
      [2, 30, "a"],
    ];
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [
        {
          mark: "point",
          encoding: { x: "hour", y: "rides", color: "kind" },
        },
      ],
    };
    const scene = compileSpec({
      spec,
      rows: colorRows,
      schema: colorSchema,
    });
    const circles = scene.marks.filter((m) => m.type === "circle");
    expect(circles[0]?.fill).toBe(circles[2]?.fill);
    expect(circles[0]?.fill).not.toBe(circles[1]?.fill);
  });
});

describe("compileSpec — error cases", () => {
  it("rejects an unsupported mark", () => {
    // `rect` is not in Phase 1's mark set yet. (Spec accepts it; compiler doesn't.)
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "rect", encoding: { x: "hour", y: "rides" } }],
    };
    expect(() => compileSpec({ spec, rows, schema })).toThrow(/Phase 1 supports marks/);
  });

  it("rejects when x or y is missing", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { y: "rides" } }],
    };
    expect(() => compileSpec({ spec, rows, schema })).toThrow();
  });

  it("throws when an encoding references a field that's not in the schema", () => {
    // Regression test for the silent-degradation bug surfaced by the
    // playground: user pastes `{layers:[{mark:"bar",encoding:{x:"hour",
    // y:"rides"}}]}` but the example CSV has columns `pickup_hour,
    // fare, rides`. Pre-fix behavior: compiler returned `undefined`
    // from `valueAt("hour")`, every row collapsed to the empty-string
    // band, and 12 bars stacked at the same X looking like ONE bar
    // covering the full plot width. No error, no warning — wrong chart
    // shipped silently. Now: throws with a clear message that names
    // the bad field AND lists what columns DO exist.
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    };
    const wrongSchema: import("./compile.js").CompileFieldInfo[] = [
      { name: "pickup_hour", type: "BIGINT" },
      { name: "rides", type: "BIGINT" },
    ];
    const wrongRows: ReadonlyArray<ReadonlyArray<unknown>> = [
      [0, 42],
      [1, 38],
    ];
    expect(() => compileSpec({ spec, rows: wrongRows, schema: wrongSchema })).toThrow(
      /encoding\.x references field "hour" .* not in the schema.*Available columns: \[pickup_hour, rides\]/,
    );
  });

  it("skips the field-existence check when rows is empty (different errors are still allowed)", () => {
    // Specs that synthesize their own rows (hierarchy, graph, function
    // shape) compile with rows=[] and a possibly-empty schema. The
    // field-existence check must skip in that case so those code paths
    // aren't broken. Other validation may still fire — we assert
    // specifically that the message we'd emit for a missing field
    // (`not in the schema`) is NOT the error raised.
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "any_field", y: "any_other" } }],
    };
    let raised: Error | undefined;
    try {
      compileSpec({ spec, rows: [], schema: [] });
    } catch (e) {
      raised = e as Error;
    }
    // Whatever error fires (if any), it must NOT be the
    // field-existence one — that's the contract this test pins.
    expect(raised?.message ?? "").not.toMatch(/not in the schema/);
  });
});

describe("compileSpec — determinism", () => {
  it("produces identical scenes for identical input", () => {
    const spec: GlyphSpec = {
      data: { source: "x" },
      layers: [{ mark: "bar", encoding: { x: "hour", y: "rides" } }],
    };
    const a = compileSpec({ spec, rows, schema });
    const b = compileSpec({ spec, rows, schema });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
