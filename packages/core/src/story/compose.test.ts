/**
 * Joy of Math PR E5 — composer unit tests.
 *
 * These tests pin the public contract of `composeStory`:
 *   - Same input → same output (pure-fn determinism)
 *   - Each registered recipe round-trips through `parseSpec` so the
 *     composed spec is wire-format valid
 *   - Audience defaults pick the right theme + caption variant
 *   - No-match returns an empty spec + suggestion-bearing Explanation
 *   - 5+ recipes are registered (the bar-raiser inventory the plan
 *     committed to)
 */

import { describe, expect, it } from "vitest";
import { parseSpec } from "../spec/parse.js";
import {
  composeStory,
  listStoryRecipes,
  listStorySuggestions,
} from "./compose.js";

describe("composeStory (Joy of Math E5)", () => {
  it("registers at least 5 recipes — sine, cosine, circle, parabola, vector field", () => {
    const recipes = listStoryRecipes();
    expect(recipes.length).toBeGreaterThanOrEqual(5);
    expect(recipes).toContain("sine");
    expect(recipes).toContain("cosine");
    expect(recipes).toContain("circle");
    expect(recipes).toContain("parabola");
    expect(recipes).toContain("vector field");
  });

  it("is deterministic — same input → same JSON across two calls", () => {
    const a = composeStory({ intent: "show me a sine wave", audience: "kid" });
    const b = composeStory({ intent: "show me a sine wave", audience: "kid" });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("composes a sine recipe spec that parses against the schema", () => {
    const r = composeStory({ intent: "show me a sine wave", audience: "kid" });
    // The composed spec must round-trip through the strict parser —
    // proves the recipe library can't silently drift from the wire format.
    const parsed = parseSpec(r.spec as unknown);
    // parseSpec throws on bad shape; reaching here means it passed.
    expect(parsed.layers.length).toBe(3);
    expect(parsed.animation?.kind).toBe("timeline");
    expect(parsed.theme).toBe("playground");
    expect(r.caption_sequence.length).toBe(3);
    // Captions are scene-keyed and use absolute begin_ms.
    expect(r.caption_sequence.map((c) => c.scene)).toEqual(["draw", "travel", "peak"]);
    expect(r.caption_sequence[0]?.at_ms).toBe(0);
  });

  it("applies kid defaults (playground theme + simple caption + larger font)", () => {
    const r = composeStory({ intent: "sine" });
    expect(r.spec.theme).toBe("playground");
    // Kid captions stay under the 8-word budget.
    for (const c of r.caption_sequence) {
      expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(8);
    }
    // The annotation layer carries the kid-sized font (>= 16).
    const annotationLayer = r.spec.layers.find(
      (l: unknown) => (l as { mark?: string }).mark === "annotation",
    ) as { annotation?: { fontSize?: number } } | undefined;
    expect(annotationLayer?.annotation?.fontSize).toBeGreaterThanOrEqual(16);
  });

  it("applies high-school defaults (light theme + mathematical captions)", () => {
    const r = composeStory({ intent: "sine wave", audience: "high-school" });
    expect(r.spec.theme).toBe("light");
    // At least one caption should land a "y = sin(x)" / "amplitude" /
    // similar mathematical phrasing — proves the per-audience variant
    // picker is actually wired up.
    const joined = r.caption_sequence.map((c) => c.text).join(" ");
    expect(/y\s*=\s*sin|amplitude|peak at/.test(joined)).toBe(true);
  });

  it("respects an explicit theme override", () => {
    const r = composeStory({ intent: "sine wave", theme: "3b1b" });
    expect(r.spec.theme).toBe("3b1b");
  });

  it("respects duration_ms — all scenes fit inside the budget", () => {
    const r = composeStory({ intent: "circle", duration_ms: 4000 });
    const scenes = r.spec.animation && "scenes" in r.spec.animation
      ? r.spec.animation.scenes
      : [];
    for (const s of scenes) {
      expect(s.begin_ms + s.duration_ms).toBeLessThanOrEqual(4000);
    }
    // The caption_sequence's last beat lands before the budget too.
    const last = r.caption_sequence[r.caption_sequence.length - 1];
    expect(last?.at_ms).toBeLessThan(4000);
  });

  it("matches case-insensitively + on partial phrases", () => {
    const a = composeStory({ intent: "Show me a SINE wave for an 8-year-old" });
    const b = composeStory({ intent: "parabola please" });
    const c = composeStory({ intent: "I want a vector field demo" });
    expect(a.caption_sequence.length).toBeGreaterThan(0);
    expect(b.caption_sequence.length).toBeGreaterThan(0);
    expect(c.caption_sequence.length).toBeGreaterThan(0);
  });

  it("no-match returns empty spec + suggestions in the Explanation", () => {
    const r = composeStory({ intent: "show me a flux capacitor" });
    expect(r.caption_sequence.length).toBe(0);
    expect(r.explanation.headline).toContain("No recipe matched");
    // suggestedFollowups must list each registered recipe verbatim.
    const suggestions = listStorySuggestions();
    const followupQuestions = r.explanation.suggestedFollowups.map((f) => f.question);
    for (const s of suggestions) {
      expect(followupQuestions).toContain(s);
    }
  });

  it("every recipe produces a parseable spec", () => {
    // One smoke test per registered recipe — exercises the "data-driven
    // registry" promise: adding a recipe means adding one object literal,
    // not patching this test.
    for (const name of listStoryRecipes()) {
      const r = composeStory({ intent: name });
      const parsed = parseSpec(r.spec as unknown);
      expect(parsed.layers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("embeds the M2 Explanation envelope with the schema tag", () => {
    const r = composeStory({ intent: "sine" });
    expect(r.explanation.format).toBe("glyph-explanation/1");
    // Each recipe's Explanation suggests the OTHER recipes — proves
    // followups can be reused by an LLM agent to chain into more
    // visualizations.
    expect(r.explanation.suggestedFollowups.length).toBeGreaterThan(0);
    expect(r.explanation.suggestedFollowups.some((f) => f.question.includes("parabola"))).toBe(
      true,
    );
  });
});
