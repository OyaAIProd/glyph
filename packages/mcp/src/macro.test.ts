/**
 * Tests for the macro module (PR70 / INNOVATION 2.5).
 */
import { describe, expect, it } from "vitest";
import {
  type Macro,
  collectMacroParams,
  isSupportedReplayVerb,
  substituteParams,
  validateMacro,
} from "./macro.js";

describe("validateMacro", () => {
  it("accepts a well-formed macro", () => {
    const m: Macro = {
      name: "test",
      version: 1,
      steps: [{ verb: "glyph_render", args: { spec: {} } }],
    };
    expect(validateMacro(m)).toBeUndefined();
  });

  it("rejects missing name", () => {
    expect(validateMacro({ version: 1, steps: [{ verb: "glyph_render", args: {} }] })).toContain(
      "name is required",
    );
  });

  it("rejects bad version", () => {
    expect(validateMacro({ name: "x", version: 2, steps: [] })).toContain("version");
  });

  it("rejects empty steps", () => {
    expect(validateMacro({ name: "x", version: 1, steps: [] })).toContain("at least one");
  });

  it("rejects an unsupported verb", () => {
    expect(
      validateMacro({
        name: "x",
        version: 1,
        steps: [{ verb: "glyph_act", args: {} }],
      }),
    ).toContain("not in the supported replay set");
  });

  it("rejects an undeclared-but-referenced param", () => {
    expect(
      validateMacro({
        name: "x",
        version: 1,
        params: [{ name: "src" }],
        steps: [{ verb: "glyph_describe", args: { source: "{{params.path}}" } }],
      }),
    ).toContain("undeclared params");
  });

  it("accepts a macro whose declared params match every reference", () => {
    expect(
      validateMacro({
        name: "x",
        version: 1,
        params: [{ name: "src" }, { name: "unused" }],
        steps: [{ verb: "glyph_describe", args: { source: "{{params.src}}" } }],
      }),
    ).toBeUndefined();
  });

  it("rejects a malformed note (non-string)", () => {
    expect(
      validateMacro({
        name: "x",
        version: 1,
        steps: [{ verb: "glyph_render", args: { spec: {} }, note: 42 }],
      }),
    ).toContain("note");
  });

  it("rejects non-object args", () => {
    expect(
      validateMacro({
        name: "x",
        version: 1,
        steps: [{ verb: "glyph_render", args: "string args" }],
      }),
    ).toContain("args must be an object");
  });
});

describe("substituteParams", () => {
  it("replaces exact-match placeholder strings", () => {
    const out = substituteParams({ src: "{{params.path}}" }, { path: "data.csv" });
    expect(out).toEqual({ src: "data.csv" });
  });

  it("does NOT expand embedded placeholders inside larger strings", () => {
    // Intentional — embedded substitution is a footgun for SQL / paths.
    const out = substituteParams({ msg: "hi {{params.name}}!" }, { name: "world" });
    expect(out).toEqual({ msg: "hi {{params.name}}!" });
  });

  it("walks arrays recursively", () => {
    const out = substituteParams(["{{params.a}}", "b", "{{params.c}}"], { a: 1, c: 3 });
    expect(out).toEqual([1, "b", 3]);
  });

  it("walks nested objects recursively", () => {
    const out = substituteParams(
      { outer: { inner: "{{params.x}}" } },
      { x: { kind: "csv", source: "data.csv" } },
    );
    expect(out).toEqual({ outer: { inner: { kind: "csv", source: "data.csv" } } });
  });

  it("throws on a referenced-but-undefined param", () => {
    expect(() => substituteParams({ x: "{{params.missing}}" }, {})).toThrow(/not supplied/);
  });

  it("passes through non-placeholder values unchanged", () => {
    const out = substituteParams({ n: 42, b: true, arr: [1, 2], obj: { k: "v" } }, {});
    expect(out).toEqual({ n: 42, b: true, arr: [1, 2], obj: { k: "v" } });
  });
});

describe("collectMacroParams", () => {
  it("collects every unique placeholder across steps", () => {
    const m: Macro = {
      name: "x",
      version: 1,
      steps: [
        { verb: "glyph_render", args: { spec: { data: { source: "{{params.path}}" } } } },
        { verb: "glyph_query", args: { handle_id: "{{params.handle}}", limit_rows: 5 } },
        // Duplicate to assert dedupe.
        { verb: "glyph_describe", args: { source: "{{params.path}}" } },
      ],
    };
    expect(collectMacroParams(m)).toEqual(["handle", "path"]);
  });

  it("returns [] for macros without placeholders", () => {
    const m: Macro = {
      name: "x",
      version: 1,
      steps: [{ verb: "glyph_render", args: { spec: {} } }],
    };
    expect(collectMacroParams(m)).toEqual([]);
  });
});

describe("isSupportedReplayVerb", () => {
  it("accepts the v0 analytic core (render / describe / query)", () => {
    expect(isSupportedReplayVerb("glyph_render")).toBe(true);
    expect(isSupportedReplayVerb("glyph_describe")).toBe(true);
    expect(isSupportedReplayVerb("glyph_query")).toBe(true);
  });

  it("rejects verbs outside the v0 scope", () => {
    // Anomaly / forecast / etc. are out of v0 scope — adding them is
    // a single-line change once their internal-helper extraction lands.
    expect(isSupportedReplayVerb("glyph_anomaly")).toBe(false);
    expect(isSupportedReplayVerb("glyph_forecast")).toBe(false);
  });

  it("rejects mutating verbs (intentional permanent exclusion)", () => {
    expect(isSupportedReplayVerb("glyph_act")).toBe(false);
    expect(isSupportedReplayVerb("glyph_memory_save")).toBe(false);
    expect(isSupportedReplayVerb("glyph_metrics_register")).toBe(false);
  });
});
