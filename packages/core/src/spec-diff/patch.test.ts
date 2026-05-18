/**
 * Tests for the JSON Patch applier (PR62 / PLAN item 1.8).
 */
import { describe, expect, it } from "vitest";
import { applyJsonPatch } from "./patch.js";

describe("applyJsonPatch (RFC 6902)", () => {
  it("replaces an object value", () => {
    const out = applyJsonPatch({ mark: "bar", encoding: { x: "year" } }, [
      { op: "replace", path: "/encoding/x", value: "month" },
    ]);
    expect(out).toEqual({ mark: "bar", encoding: { x: "month" } });
  });

  it("adds a new key into an object", () => {
    const out = applyJsonPatch({ mark: "bar" }, [
      { op: "add", path: "/encoding", value: { y: "revenue" } },
    ]);
    expect(out).toEqual({ mark: "bar", encoding: { y: "revenue" } });
  });

  it("appends to an array via '-'", () => {
    const out = applyJsonPatch({ layers: [{ mark: "bar" }] }, [
      { op: "add", path: "/layers/-", value: { mark: "line" } },
    ]);
    expect(out).toEqual({ layers: [{ mark: "bar" }, { mark: "line" }] });
  });

  it("inserts at an array index", () => {
    const out = applyJsonPatch({ layers: [{ mark: "a" }, { mark: "c" }] }, [
      { op: "add", path: "/layers/1", value: { mark: "b" } },
    ]);
    expect(out).toEqual({ layers: [{ mark: "a" }, { mark: "b" }, { mark: "c" }] });
  });

  it("removes an array element", () => {
    const out = applyJsonPatch({ layers: [{ mark: "a" }, { mark: "b" }, { mark: "c" }] }, [
      { op: "remove", path: "/layers/1" },
    ]);
    expect(out).toEqual({ layers: [{ mark: "a" }, { mark: "c" }] });
  });

  it("removes an object key", () => {
    const out = applyJsonPatch({ mark: "bar", color: "red" }, [{ op: "remove", path: "/color" }]);
    expect(out).toEqual({ mark: "bar" });
  });

  it("copies a value", () => {
    const out = applyJsonPatch({ a: 1 }, [{ op: "copy", from: "/a", path: "/b" }]);
    expect(out).toEqual({ a: 1, b: 1 });
  });

  it("moves a value (rename)", () => {
    const out = applyJsonPatch({ a: 1 }, [{ op: "move", from: "/a", path: "/b" }]);
    expect(out).toEqual({ b: 1 });
  });

  it("test op passes when value matches", () => {
    const out = applyJsonPatch({ a: 1 }, [{ op: "test", path: "/a", value: 1 }]);
    expect(out).toEqual({ a: 1 });
  });

  it("test op throws when value differs", () => {
    expect(() => applyJsonPatch({ a: 1 }, [{ op: "test", path: "/a", value: 2 }])).toThrow(
      /test failed/,
    );
  });

  it("supports escaped path tokens (~1 = /, ~0 = ~)", () => {
    const out = applyJsonPatch({ "a/b": 1 }, [{ op: "replace", path: "/a~1b", value: 99 }]);
    expect(out).toEqual({ "a/b": 99 });
  });

  it("does not mutate the input document", () => {
    const input = { mark: "bar" };
    applyJsonPatch(input, [{ op: "replace", path: "/mark", value: "line" }]);
    expect(input).toEqual({ mark: "bar" });
  });

  it("reports the failing op index in the error message", () => {
    expect(() =>
      applyJsonPatch({ a: 1 }, [
        { op: "replace", path: "/a", value: 2 },
        { op: "replace", path: "/missing", value: 0 },
      ]),
    ).toThrow(/op\[1\]/);
  });
});
