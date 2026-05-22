/**
 * Joy of Math PR E5 — `glyph_story` natural-language composer.
 *
 * Pure-fn recipe composer. Given a natural-language intent ("show me a
 * sine wave for an 8-year-old"), look up a canonical recipe and emit a
 * multi-scene Glyph spec ready for `compileSpec` + `renderSvg` — plus a
 * pre-built structured Explanation (M2) and a flat caption sequence the
 * UI can subscribe to without re-parsing the spec.
 *
 * No LLM is invoked. The mapping from intent → recipe is data-driven:
 *
 *   - Each entry in `RECIPES` declares a friendly name, a list of
 *     case-insensitive keyword patterns, and a `build()` function that
 *     produces the spec / captions for a chosen audience + theme +
 *     duration.
 *   - Adding a new recipe means appending one object literal to the
 *     `RECIPES` array — no branching changes elsewhere in this file or
 *     in the MCP server.
 *
 * Composition with the rest of the codebase:
 *   - E1 annotation marks (`mark: "annotation"`) — "peak!", "vertex", etc.
 *   - E2 traveler marks (`mark: "traveler"`) — the kid-delight dot.
 *   - E3 timeline animation (`animation.kind: "timeline"`) — sequenced scenes.
 *   - E4 brand presets (`theme: "playground" | "3b1b" | "light" | "dark"`).
 *   - M2 structured Explanation envelope (`glyph-explanation/1`).
 *   - M1 provenance config is forwarded on the returned spec; the seal is
 *     attached by `compileSpec` at render time.
 *
 * Determinism contract: same `(intent, audience, theme, duration_ms)` →
 * same JSON bytes. No clock, no PRNG, no LLM. The downstream
 * `compileSpec` + `renderSvg` pipeline already guarantees byte-stable
 * SVGs from a byte-stable spec.
 */

import type { Explanation } from "../diagnostics/structured-explain.js";
import type { GlyphSpec } from "../spec/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Audience the composed spec is targeted at. Drives theme + caption defaults. */
export type StoryAudience = "kid" | "high-school" | "adult";

/** One caption keyed to a scene id, with its absolute begin time in ms. */
export interface StoryCaption {
  /** Scene id the caption belongs to. Mirrors `animation.scenes[].id`. */
  readonly scene: string;
  /** Caption text — already truncated to the audience's preferred length. */
  readonly text: string;
  /** Absolute begin time in ms (mirrors `animation.scenes[].begin_ms`). */
  readonly at_ms: number;
}

/** Input to `composeStory`. */
export interface ComposeStoryInput {
  /** Natural-language phrase — "show me a sine wave for an 8-year-old". */
  readonly intent: string;
  /** Reader persona; default "kid". */
  readonly audience?: StoryAudience;
  /**
   * Theme preset. Defaults to "playground" for kid audiences, "light"
   * otherwise. Pass a known preset string (`"light" | "dark" |
   * "playground" | "3b1b"`); inline ThemeConfig overrides are out of
   * scope for the composer.
   */
  readonly theme?: string;
  /** Total animation duration in ms; default 8000. */
  readonly duration_ms?: number;
}

/** Output of `composeStory`. */
export interface ComposeStoryResult {
  /** Multi-scene Glyph spec — render via `renderSvg(compileSpec(...))`. */
  readonly spec: GlyphSpec;
  /** Pre-built structured Explanation (M2 envelope). */
  readonly explanation: Explanation;
  /** Flat caption sequence — one entry per scene with a caption. */
  readonly caption_sequence: ReadonlyArray<StoryCaption>;
}

// ---------------------------------------------------------------------------
// Audience defaults
// ---------------------------------------------------------------------------

interface AudienceDefaults {
  readonly theme: string;
  readonly fontSize: number;
  /** Max words per caption — drives the picker for the per-audience caption variant. */
  readonly maxCaptionWords: number;
  /** Caption style flag — drives the picker for the per-audience caption variant. */
  readonly captionStyle: "simple" | "mathematical" | "minimal";
}

const AUDIENCE_DEFAULTS: Readonly<Record<StoryAudience, AudienceDefaults>> = {
  kid: { theme: "playground", fontSize: 16, maxCaptionWords: 8, captionStyle: "simple" },
  "high-school": {
    theme: "light",
    fontSize: 14,
    maxCaptionWords: 14,
    captionStyle: "mathematical",
  },
  adult: { theme: "light", fontSize: 13, maxCaptionWords: 20, captionStyle: "minimal" },
};

// ---------------------------------------------------------------------------
// Recipe contract
// ---------------------------------------------------------------------------

/** Captions for the three audiences — picked at compose time. */
interface AudienceCaption {
  readonly simple: string;
  readonly mathematical: string;
  readonly minimal: string;
}

/** One scene's contract — id, beat, layers, plus per-audience caption variants. */
interface RecipeScene {
  readonly id: string;
  readonly beginFrac: number;
  readonly durFrac: number;
  readonly layers: ReadonlyArray<number>;
  readonly caption?: AudienceCaption;
}

interface RecipeContext {
  readonly audience: StoryAudience;
  readonly theme: string;
  readonly duration_ms: number;
  readonly defaults: AudienceDefaults;
}

interface Recipe {
  /** Friendly name surfaced in `Explanation.suggestedFollowups` when nothing matches. */
  readonly name: string;
  /** Lowercase phrase variants we match `intent` against. */
  readonly keywords: ReadonlyArray<string>;
  /** Human-facing follow-up phrase (used by no-match fallback to suggest this recipe). */
  readonly suggest: string;
  /** Headline used in the structured Explanation. */
  readonly headline: string;
  /** Body-grade chart-type rationale for M2. */
  readonly chartType: string;
  readonly chartRationale: string;
  /** Builds the raw spec layers + scene blueprint for this recipe. */
  readonly build: (ctx: RecipeContext) => {
    readonly layers: ReadonlyArray<Record<string, unknown>>;
    readonly data?: Record<string, unknown>;
    readonly scenes: ReadonlyArray<RecipeScene>;
    /** Optional title override; falls back to `name` when omitted. */
    readonly title?: string;
  };
}

// ---------------------------------------------------------------------------
// Caption helpers
// ---------------------------------------------------------------------------

function pickCaption(
  c: AudienceCaption | undefined,
  style: AudienceDefaults["captionStyle"],
): string | undefined {
  if (!c) return undefined;
  return c[style];
}

/** Truncate a caption to `maxWords` while keeping it readable. */
function clampWords(text: string, maxWords: number): string {
  const parts = text.split(/\s+/);
  if (parts.length <= maxWords) return text;
  return `${parts.slice(0, maxWords).join(" ")}…`;
}

// ---------------------------------------------------------------------------
// Recipes — the entire surface lives in this array
// ---------------------------------------------------------------------------

const TAU = 6.283185307179586;
const PI = Math.PI;
const HALF_PI = 1.5707963267948966;

/**
 * Build a 3-scene scaffolding for the canonical sine / cosine recipe:
 *   scene 0: draw the curve (line layer)
 *   scene 1: traveling dot follows the curve
 *   scene 2: "peak!" annotation lands
 */
function buildTrigRecipe(
  ctx: RecipeContext,
  opts: { readonly fn: "sin" | "cos"; readonly peakX: number; readonly peakY: number },
): ReturnType<Recipe["build"]> {
  const expr = `${opts.fn}(x)`;
  const layers: Record<string, unknown>[] = [
    {
      id: "curve",
      mark: "line",
      encoding: {
        x: { field: "x", type: "quantitative", scale: { domain: [-TAU, TAU] } },
        y: { field: "y", type: "quantitative", scale: { domain: [-1.3, 1.3] } },
      },
    },
    {
      mark: "traveler",
      encoding: {
        x: { field: "x", type: "quantitative" },
        y: { field: "y", type: "quantitative" },
      },
      traveler: {
        follow: { layerId: "curve" },
        duration_ms: Math.max(1000, Math.floor(ctx.duration_ms / 2)),
        radius: ctx.audience === "kid" ? 6 : 4,
        trail: { length: 0.2, fade: true },
      },
    },
    {
      mark: "annotation",
      encoding: {
        x: { field: "x", type: "quantitative" },
        y: { field: "y", type: "quantitative" },
      },
      annotation: {
        anchor: { kind: "coord", x: opts.peakX, y: opts.peakY },
        text: opts.fn === "sin" ? "peak!" : "max!",
        arrow: "auto",
        fontSize: ctx.defaults.fontSize,
      },
    },
  ];

  // beginFrac / durFrac for a 3-scene timeline. Beat 0 dominates the
  // intro; the dot and annotation follow at the back half. We allocate
  // ~30% of the budget to drawing the curve so the kid sees it grow.
  return {
    layers,
    data: {
      function: {
        shape: "function",
        x: { min: -TAU, max: TAU, samples: 120 },
        expr,
      },
    },
    title: opts.fn === "sin" ? "Sine wave" : "Cosine wave",
    scenes: [
      {
        id: "draw",
        beginFrac: 0,
        durFrac: 0.3125,
        layers: [0],
        caption: {
          simple: opts.fn === "sin" ? "Watch the wave grow" : "Watch the cosine grow",
          mathematical: opts.fn === "sin" ? "y = sin(x), amplitude = 1" : "y = cos(x), period = 2π",
          minimal: opts.fn === "sin" ? "y = sin(x)" : "y = cos(x)",
        },
      },
      {
        id: "travel",
        beginFrac: 0.3125,
        durFrac: 0.5,
        layers: [1],
        caption: {
          simple: "A dot rides the wave",
          mathematical: "Sample point sweeps left to right",
          minimal: "Trace.",
        },
      },
      {
        id: "peak",
        beginFrac: 0.8125,
        durFrac: 0.1875,
        layers: [2],
        caption: {
          simple: opts.fn === "sin" ? "That's the peak!" : "There's the max!",
          mathematical: opts.fn === "sin" ? "Peak at x = π/2, y = 1" : "Max at x = 0, y = 1",
          minimal: opts.fn === "sin" ? "Peak: (π/2, 1)" : "Max: (0, 1)",
        },
      },
    ],
  };
}

const RECIPES: ReadonlyArray<Recipe> = [
  {
    name: "sine",
    keywords: ["sine", "sin wave", "sin(x)", "sinewave"],
    suggest: "show me a sine wave",
    headline: "y = sin(x) traces the canonical wave shape from −2π to 2π.",
    chartType: "line",
    chartRationale: "Continuous quantitative y over continuous x — a line mark is the natural fit.",
    build: (ctx) => buildTrigRecipe(ctx, { fn: "sin", peakX: HALF_PI, peakY: 1 }),
  },
  {
    name: "cosine",
    keywords: ["cosine", "cos wave", "cos(x)"],
    suggest: "show me a cosine wave",
    headline: "y = cos(x) is the same wave as sine, shifted left by π/2.",
    chartType: "line",
    chartRationale: "Continuous y over continuous x — a line mark traces the curve naturally.",
    build: (ctx) => buildTrigRecipe(ctx, { fn: "cos", peakX: 0, peakY: 1 }),
  },
  {
    name: "circle",
    keywords: ["circle", "circumference", "2pir", "2 pi r", "unit circle"],
    suggest: "show me a circle (circumference = 2πr)",
    headline: "A unit circle has radius 1 and circumference 2π.",
    chartType: "line (parametric)",
    chartRationale:
      "A circle is a parametric (x=cos t, y=sin t) curve — line over a parametric data source traces it cleanly.",
    build: (ctx) => ({
      data: {
        function: {
          shape: "function",
          parameter: { name: "t", min: 0, max: TAU, samples: 96 },
          xExpr: "cos(t)",
          yExpr: "sin(t)",
        },
      },
      title: "Circle — circumference = 2πr",
      layers: [
        {
          id: "circle-curve",
          mark: "line",
          encoding: {
            x: { field: "x", type: "quantitative", scale: { domain: [-1.4, 1.4] } },
            y: { field: "y", type: "quantitative", scale: { domain: [-1.4, 1.4] } },
          },
        },
        {
          mark: "annotation",
          encoding: {
            x: { field: "x", type: "quantitative" },
            y: { field: "y", type: "quantitative" },
          },
          annotation: {
            anchor: { kind: "coord", x: 1, y: 0 },
            text: "r = 1",
            arrow: "auto",
            fontSize: ctx.defaults.fontSize,
          },
        },
        {
          mark: "annotation",
          encoding: {
            x: { field: "x", type: "quantitative" },
            y: { field: "y", type: "quantitative" },
          },
          annotation: {
            anchor: { kind: "coord", x: 0, y: 0 },
            text: "C = 2π × r",
            arrow: "auto",
            fontSize: ctx.defaults.fontSize,
          },
        },
      ],
      scenes: [
        {
          id: "draw",
          beginFrac: 0,
          durFrac: 0.375,
          layers: [0],
          caption: {
            simple: "First, draw a circle",
            mathematical: "Parameterized by (cos t, sin t)",
            minimal: "Draw circle.",
          },
        },
        {
          id: "radius",
          beginFrac: 0.375,
          durFrac: 0.25,
          layers: [1],
          caption: {
            simple: "The radius is one",
            mathematical: "Radius r = 1 at (1, 0)",
            minimal: "r = 1.",
          },
        },
        {
          id: "circumference",
          beginFrac: 0.625,
          durFrac: 0.375,
          layers: [2],
          caption: {
            simple: "Around the edge is 2π × r",
            mathematical: "Circumference C = 2πr ≈ 6.28",
            minimal: "C = 2πr.",
          },
        },
      ],
    }),
  },
  {
    name: "parabola",
    keywords: ["parabola", "x squared", "x^2", "x*x", "quadratic"],
    suggest: "show me a parabola",
    headline: "y = x² is the simplest parabola — the U-shaped curve.",
    chartType: "line",
    chartRationale: "A scalar function y = x² renders as a line over evenly-sampled x.",
    build: (ctx) => ({
      data: {
        function: {
          shape: "function",
          x: { min: -3, max: 3, samples: 80 },
          expr: "x*x",
        },
      },
      title: "Parabola: y = x²",
      layers: [
        {
          id: "parabola-curve",
          mark: "line",
          encoding: {
            x: { field: "x", type: "quantitative", scale: { domain: [-3, 3] } },
            y: { field: "y", type: "quantitative", scale: { domain: [0, 9] } },
          },
        },
        {
          mark: "annotation",
          encoding: {
            x: { field: "x", type: "quantitative" },
            y: { field: "y", type: "quantitative" },
          },
          annotation: {
            anchor: { kind: "coord", x: 0, y: 0 },
            text: "vertex",
            arrow: "auto",
            fontSize: ctx.defaults.fontSize,
          },
        },
      ],
      scenes: [
        {
          id: "draw",
          beginFrac: 0,
          durFrac: 0.625,
          layers: [0],
          caption: {
            simple: "y = x squared",
            mathematical: "y = x², a quadratic",
            minimal: "y = x².",
          },
        },
        {
          id: "vertex",
          beginFrac: 0.625,
          durFrac: 0.375,
          layers: [1],
          caption: {
            simple: "Lowest point: the vertex",
            mathematical: "Vertex at (0, 0)",
            minimal: "Vertex: (0, 0).",
          },
        },
      ],
    }),
  },
  {
    name: "vector field",
    keywords: ["vector field", "streamlines", "flow field", "stream lines", "flow lines"],
    suggest: "show me a vector field",
    headline:
      "A 2D vector field dx/dt = −y, dy/dt = x rotates points around the origin; streamlines trace the flow.",
    chartType: "streamline",
    chartRationale:
      "Streamlines integrate the vector field forward + backward from a grid of seeds — the right primitive for visualizing flow.",
    build: (ctx) => ({
      data: { source: "inline:story-vector-field" },
      title: "Vector field — rotation",
      layers: [
        {
          id: "field",
          mark: "streamline",
          encoding: {
            x: { field: "x", type: "quantitative", scale: { domain: [-2, 2] } },
            y: { field: "y", type: "quantitative", scale: { domain: [-2, 2] } },
          },
          streamline: {
            dxdt: "-y",
            dydt: "x",
            seeds: { kind: "grid", rows: 4, cols: 4 },
            step: 0.05,
            maxSteps: 200,
            domain: { x: [-2, 2], y: [-2, 2] },
          },
        },
      ],
      scenes: [
        {
          id: "flow",
          beginFrac: 0,
          durFrac: 1,
          layers: [0],
          caption: {
            simple: "Each arrow shows the flow",
            mathematical: "dx/dt = −y, dy/dt = x — rotation",
            minimal: "Field: (−y, x).",
          },
        },
      ],
    }),
    // Vector field doesn't compose with the trig-style traveler/annotation;
    // the streamline mark itself is the visualization. Keeping it as a
    // 1-scene recipe matches the plan's "1 scene (draw + label a few flow
    // lines)" wording. The caption acts as the label.
  },
];

// ---------------------------------------------------------------------------
// Recipe matching
// ---------------------------------------------------------------------------

function findRecipe(intent: string): Recipe | undefined {
  const lc = intent.toLowerCase();
  // Walk the registry in declaration order; first match wins. The
  // keyword lists are short and curated, so this is O(recipes × keywords)
  // — trivial at the scale we ship.
  for (const recipe of RECIPES) {
    for (const kw of recipe.keywords) {
      if (lc.includes(kw)) return recipe;
    }
  }
  return undefined;
}

/** Public — the friendly names of every registered recipe, in declaration order. */
export function listStoryRecipes(): ReadonlyArray<string> {
  return RECIPES.map((r) => r.name);
}

/** Public — the suggest-phrases for every registered recipe (used by no-match fallback). */
export function listStorySuggestions(): ReadonlyArray<string> {
  return RECIPES.map((r) => r.suggest);
}

// ---------------------------------------------------------------------------
// Spec assembly + Explanation envelope
// ---------------------------------------------------------------------------

function audienceFor(input: ComposeStoryInput): StoryAudience {
  return input.audience ?? "kid";
}

function themeFor(input: ComposeStoryInput, defaults: AudienceDefaults): string {
  return input.theme ?? defaults.theme;
}

function durationFor(input: ComposeStoryInput): number {
  // Clamp to the SMIL animate range used by `animation.kind: "timeline"`
  // (begin_ms tops at 600_000ms, duration_ms at 60_000ms); 8s is the
  // documented default and the bar-raiser demo's pacing.
  const raw = input.duration_ms ?? 8000;
  if (!Number.isFinite(raw)) return 8000;
  return Math.min(120_000, Math.max(1000, Math.round(raw)));
}

function emptyExplanation(headline: string, followups: ReadonlyArray<string>): Explanation {
  return {
    headline,
    keyInsights: [],
    potentialMisreadings: [],
    dataSources: [],
    chartTypeRationale: {
      chartType: "(none)",
      rationale: "No recipe matched the intent; nothing was drawn.",
      alternatives: [],
    },
    suggestedFollowups: followups.map((q) => ({ question: q })),
    format: "glyph-explanation/1",
  };
}

function buildExplanation(
  recipe: Recipe,
  ctx: RecipeContext,
  captions: ReadonlyArray<StoryCaption>,
): Explanation {
  const insights = captions.map((c) => ({
    insight: c.text,
    confidence: "high" as const,
  }));
  return {
    headline: recipe.headline,
    keyInsights: insights,
    potentialMisreadings: [],
    dataSources: [
      {
        field: "data",
        value: `recipe:${recipe.name}`,
      },
    ],
    chartTypeRationale: {
      chartType: recipe.chartType,
      rationale: recipe.chartRationale,
      alternatives: [],
    },
    suggestedFollowups: RECIPES.filter((r) => r.name !== recipe.name).map((r) => ({
      question: r.suggest,
    })),
    format: "glyph-explanation/1",
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Pure-fn composer. Same input always yields the same output. The
 * returned spec is shaped to parse against `GlyphSpecSchema` (assuming
 * a matched recipe); the no-match branch returns a spec with `layers:
 * []`, which is deliberately rejected by the strict parser — callers
 * inspect `caption_sequence.length === 0` (or
 * `explanation.headline.includes("No recipe matched")`) to detect the
 * fallback path before piping the spec to `compileSpec`.
 */
export function composeStory(input: ComposeStoryInput): ComposeStoryResult {
  const audience = audienceFor(input);
  const defaults = AUDIENCE_DEFAULTS[audience];
  const theme = themeFor(input, defaults);
  const duration_ms = durationFor(input);

  const recipe = findRecipe(input.intent);
  if (!recipe) {
    const followups = RECIPES.map((r) => r.suggest);
    return {
      // No layers — the strict parser will reject this; callers must
      // check `caption_sequence.length === 0` first. We type-cast
      // through `unknown` so the public signature stays GlyphSpec.
      spec: { layers: [] } as unknown as GlyphSpec,
      explanation: emptyExplanation(
        `No recipe matched "${input.intent}". Try one of the suggestions below.`,
        followups,
      ),
      caption_sequence: [],
    };
  }

  const ctx: RecipeContext = { audience, theme, duration_ms, defaults };
  const built = recipe.build(ctx);

  // Map relative beginFrac/durFrac → absolute ms. Round to integer ms so
  // SMIL `begin="…ms"` stays byte-stable across runs.
  const scenes = built.scenes.map((s) => {
    const begin_ms = Math.round(s.beginFrac * duration_ms);
    const dur_ms = Math.max(50, Math.round(s.durFrac * duration_ms));
    const captionText = pickCaption(s.caption, defaults.captionStyle);
    const captionClamped = captionText
      ? clampWords(captionText, defaults.maxCaptionWords)
      : undefined;
    const out: Record<string, unknown> = {
      id: s.id,
      begin_ms,
      duration_ms: dur_ms,
      layers: [...s.layers],
    };
    if (captionClamped) out.caption = captionClamped;
    return out;
  });

  // Caption sequence is a flat view of the scenes — agents that don't
  // want to walk the spec can fade captions in directly.
  const caption_sequence: StoryCaption[] = scenes
    .filter((s): s is typeof s & { caption: string } => typeof s.caption === "string")
    .map((s) => ({
      scene: s.id as string,
      text: s.caption as string,
      at_ms: s.begin_ms as number,
    }));

  // Assemble the spec. We forward the theme; M1's cryptographic
  // provenance seal is attached by `compileSpec` / `renderSvg` at
  // render time. `provenance.includeTimestamp` defaults to false so
  // re-renders stay byte-identical — the determinism contract every
  // other Glyph feature relies on.
  const spec = {
    version: "glyph/0.1",
    title: built.title ?? recipe.name,
    data: built.data,
    layers: built.layers,
    theme,
    animation: { kind: "timeline", scenes },
    provenance: { includeTimestamp: false },
  } as unknown as GlyphSpec;

  const explanation = buildExplanation(recipe, ctx, caption_sequence);

  return { spec, explanation, caption_sequence };
}
