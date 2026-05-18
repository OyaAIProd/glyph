/**
 * Tests for morphScenes (PR74 / D3 Gap 3).
 */
import { describe, expect, it } from "vitest";
import { renderSvg } from "../render/svg.js";
import type { Scene } from "../scenegraph/types.js";
import { morphScenes } from "./morph.js";

const sceneA: Scene = {
  width: 200,
  height: 100,
  background: "#fff",
  plotArea: { x: 10, y: 10, width: 180, height: 80 },
  axes: [],
  marks: [
    { type: "rect", x: 0, y: 0, width: 10, height: 50, fill: "#1f77b4" },
    { type: "rect", x: 20, y: 0, width: 10, height: 70, fill: "#1f77b4" },
  ],
};

const sceneB: Scene = {
  width: 200,
  height: 100,
  background: "#fff",
  plotArea: { x: 10, y: 10, width: 180, height: 80 },
  axes: [],
  marks: [
    { type: "rect", x: 0, y: 0, width: 60, height: 50, fill: "#1f77b4" },
    { type: "rect", x: 20, y: 0, width: 60, height: 30, fill: "#1f77b4" },
  ],
};

describe("morphScenes", () => {
  it("attaches a morph animation with fromMarks aligned to marks", () => {
    const out = morphScenes(sceneA, sceneB);
    expect(out.animation?.kind).toBe("morph");
    if (out.animation?.kind === "morph") {
      expect(out.animation.fromMarks.length).toBe(out.marks.length);
      expect(out.animation.duration_ms).toBe(600);
    }
  });

  it("honors duration_ms override", () => {
    const out = morphScenes(sceneA, sceneB, { duration_ms: 1500 });
    if (out.animation?.kind === "morph") {
      expect(out.animation.duration_ms).toBe(1500);
    }
  });

  it("rejects when mark counts differ", () => {
    const truncated: Scene = { ...sceneB, marks: sceneB.marks.slice(0, 1) };
    expect(() => morphScenes(sceneA, truncated)).toThrow(/mark count differs/);
  });

  it("rejects when mark types disagree at any index", () => {
    const mixed: Scene = {
      ...sceneB,
      marks: [
        { type: "circle", cx: 5, cy: 5, r: 3, fill: "#000" },
        sceneB.marks[1] as Scene["marks"][number],
      ],
    };
    expect(() => morphScenes(sceneA, mixed)).toThrow(/type mismatch/);
  });

  it("rejects unsupported mark types (path/text/arc)", () => {
    const withPath: Scene = {
      ...sceneA,
      marks: [{ type: "path", d: "M 0 0 L 10 10" }, sceneA.marks[1] as Scene["marks"][number]],
    };
    const withPath2: Scene = {
      ...sceneB,
      marks: [{ type: "path", d: "M 5 5 L 50 50" }, sceneB.marks[1] as Scene["marks"][number]],
    };
    expect(() => morphScenes(withPath, withPath2)).toThrow(/not supported in v0/);
  });

  it("renderer emits SMIL <animate> elements for rect attrs", () => {
    const out = morphScenes(sceneA, sceneB);
    const svg = renderSvg(out);
    // Two rects × 4 attrs (x, y, width, height) = 8 animate elements.
    const matches = svg.match(/<animate /g) ?? [];
    expect(matches.length).toBe(8);
    // fill="freeze" pins the end state.
    expect(svg).toContain('fill="freeze"');
  });

  it("is deterministic — same input → same SVG bytes", () => {
    const a = renderSvg(morphScenes(sceneA, sceneB));
    const b = renderSvg(morphScenes(sceneA, sceneB));
    expect(a).toBe(b);
  });

  it("byte-identical for scenes without morph (no regression)", () => {
    const a = renderSvg(sceneA);
    const b = renderSvg(sceneA);
    expect(a).toBe(b);
    // No SMIL animation should leak into a scene without animation set.
    expect(a).not.toContain("<animate");
  });
});
