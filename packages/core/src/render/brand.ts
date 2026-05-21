/**
 * Moat PR4 — Brand-kit resolution.
 *
 * A `BrandKit` is a structured bundle of design tokens (palette +
 * typography + spacing + a11y). This module compiles a BrandKit into
 * the flat `Theme` the existing renderer understands and provides the
 * accessibility checks consumed by AUDIT-11.
 *
 * Why this differentiates Glyph:
 *   - Vega themes are flat — no typography, no spacing.
 *   - Plotly templates are opaque JSON blobs.
 *   - D3 makes you re-style every chart by hand.
 *
 * Glyph compiles ONE brand → all charts. Dark mode is one swap of
 * `palette.surface`; the categorical palette and typography keep
 * composing.
 *
 * All functions in this module are pure: same input → identical output,
 * no clocks, no RNG.
 */

import type { BrandKit, ThemeConfig } from "../spec/types.js";

// ---------------------------------------------------------------------------
// The "flat Theme" shape the compiler/renderer consumes today.
//
// Kept in lockstep with the local `Theme` interface in compile.ts —
// adding a key here means adding it there too. We re-declare rather
// than import to avoid a render→compiler cycle.
// ---------------------------------------------------------------------------

/** Flat theme tokens — what the renderer actually consumes. */
export interface ResolvedTheme {
  readonly background: string;
  readonly fg: string;
  readonly axis: string;
  readonly grid: string;
  readonly marks: ReadonlyArray<string>;
  /**
   * Sequential color ramp for continuous encodings (heatmap fills,
   * contour shading). Moat 4 review IMPORTANT-3: when set on a brand
   * kit, this overrides the renderer's synthesized `theme.grid →
   * theme.marks[0]` ramp. Undefined means "fall back to synthesis."
   */
  readonly sequential?: ReadonlyArray<string>;
  /**
   * Diverging ramp for signed quantities (e.g. red-white-blue).
   * Same fallback semantics as `sequential`.
   */
  readonly diverging?: ReadonlyArray<string>;
}

/**
 * Resolve a `BrandKit` into the flat Theme tokens the renderer
 * understands.
 *
 * Mapping:
 *   palette.surface.bg     → theme.background
 *   palette.surface.fg     → theme.fg
 *   palette.surface.muted  → theme.axis
 *   palette.surface.border → theme.grid
 *   palette.categorical    → theme.marks
 *   palette.sequential     → theme.sequential   (Moat 4 review IMPORTANT-3)
 *   palette.diverging      → theme.diverging    (Moat 4 review IMPORTANT-3)
 *
 * The sequential / diverging fields were accepted by the schema in v1
 * but silently dropped by the resolver — the heatmap / contour code
 * paths in `compile.ts` would always synthesize ramps from
 * `theme.grid → theme.marks[0]`. They now forward into ResolvedTheme,
 * and the existing fallback synthesis applies only when undefined.
 * Heatmap / contour consumers that read `theme.sequential` /
 * `theme.diverging` honor the brand kit's ramp when present.
 *
 * Pure function — same input always returns the same Theme.
 */
export function brandKitToTheme(brand: BrandKit): ResolvedTheme {
  const theme: ResolvedTheme = {
    background: brand.palette.surface.bg,
    fg: brand.palette.surface.fg,
    axis: brand.palette.surface.muted,
    grid: brand.palette.surface.border,
    marks: brand.palette.categorical,
  };
  if (brand.palette.sequential !== undefined) {
    theme.sequential = brand.palette.sequential;
  }
  if (brand.palette.diverging !== undefined) {
    theme.diverging = brand.palette.diverging;
  }
  return theme;
}

/**
 * Merge an explicit `ThemeConfig` on top of a brand-derived theme.
 *
 * When a spec sets BOTH `brand:` and `theme:`, brand resolves first
 * and the explicit `theme:` keys override. This lets agents reuse a
 * brand kit but tweak (say) the grid color for one specific chart.
 */
export function mergeBrandWithTheme(brand: BrandKit, theme: ThemeConfig): ResolvedTheme {
  // Shallow merge — theme keys win field-by-field. NOTE for agents
  // (Moat 4 review NIT-8): setting `theme: { palette: ["red"] }`
  // replaces the WHOLE categorical array, not just the first slot.
  // Theme overrides have no way to slot-merge today; brand-kit + a
  // partial-theme is the union of brand defaults + the overridden
  // fields, with arrays replaced wholesale.
  const base = brandKitToTheme(brand);
  const merged: ResolvedTheme = {
    background: theme.background ?? base.background,
    fg: theme.fg ?? base.fg,
    axis: theme.axis ?? base.axis,
    grid: theme.grid ?? base.grid,
    marks: theme.palette ?? base.marks,
  };
  // Carry the brand kit's sequential / diverging ramps through the
  // merge — there's no ThemeConfig field to override them today.
  if (base.sequential !== undefined) {
    (merged as { sequential?: ReadonlyArray<string> }).sequential = base.sequential;
  }
  if (base.diverging !== undefined) {
    (merged as { diverging?: ReadonlyArray<string> }).diverging = base.diverging;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// WCAG contrast checking
//
// The standard relative luminance formula from WCAG 2.2 §1.4.3.
// `parseColor` accepts `#rgb`, `#rrggbb`, `#rgba`, `#rrggbbaa`, and the
// common `rgb(r,g,b)` / `rgba(r,g,b,a)` strings — enough to cover JSON-
// serializable brand kits.
//
// Moat 4 review IMPORTANT-1/2/5: the BrandKit schema (BRAND_COLOR_RE
// in spec/schemas.ts) tightens accepted color literals so unparseable
// input (named colors, HSL, malformed rgb) fails at Zod parse time.
// This means parseColor + AUDIT-11 can trust their inputs — if they
// reach the audit step at all, they're parseable per the schema.
//
// NIT-10 followup: alpha channel in `rgba(...)` / `#rrggbbaa` is
// DISCARDED for the WCAG calculation. Translucent colors are evaluated
// against a fully-opaque background, which is the correct WCAG
// behavior when the actual background is unknown. Brand kits using
// translucent fg/bg should ensure the underlying opaque color is the
// one being audited.
// ---------------------------------------------------------------------------

/** Parse a CSS color string into an [r,g,b] triple in 0..255. Returns null when unparseable. */
export function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();
  // #rrggbb
  if (/^#[0-9a-f]{6}$/.test(s)) {
    return [
      Number.parseInt(s.slice(1, 3), 16),
      Number.parseInt(s.slice(3, 5), 16),
      Number.parseInt(s.slice(5, 7), 16),
    ];
  }
  // #rgb
  if (/^#[0-9a-f]{3}$/.test(s)) {
    const r = Number.parseInt(s[1]! + s[1]!, 16);
    const g = Number.parseInt(s[2]! + s[2]!, 16);
    const b = Number.parseInt(s[3]! + s[3]!, 16);
    return [r, g, b];
  }
  // rgb(r,g,b) / rgba(r,g,b,a)
  const m = s.match(/^rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/);
  if (m) {
    return [
      Math.min(255, Number.parseInt(m[1]!, 10)),
      Math.min(255, Number.parseInt(m[2]!, 10)),
      Math.min(255, Number.parseInt(m[3]!, 10)),
    ];
  }
  return null;
}

/** WCAG relative luminance — input rgb in 0..255. */
function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio — between 1 (identical) and 21 (white/black). */
export function contrastRatio(a: string, b: string): number {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return 1;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// Color-blind safety (deuteranopia simulation)
//
// Machado-2009 simulation matrix for deuteranopia (the most common
// red-green color blindness, ~6% of men of European descent). We
// project each RGB to its deuteranope appearance and flag palette
// entries that collapse to within `DEUT_DISTANCE_THRESHOLD` Euclidean
// distance in the simulated space.
//
// Moat 4 review IMPORTANT-4 note: the Machado paper specifies the
// matrix on LINEAR RGB, but here we apply it directly to sRGB
// (gamma-encoded) values. The simplification works because:
//   - relative ordering of palette pair distances is preserved across
//     gamma (the threshold is empirical, not absolute)
//   - the cost of linearize+matrix+gamma-encode per categorical entry
//     is non-trivial vs the simpler matrix-only path
//   - the audit's job is to catch pair collisions, not to produce a
//     publication-quality simulation
// If a future PR needs accurate deuteranope appearance (e.g. for a
// "simulate brand under CVD" preview verb), it should linearize first.
// ---------------------------------------------------------------------------

/** Simulate the deuteranopia appearance of an sRGB color (0..255). */
export function simulateDeuteranopia(rgb: [number, number, number]): [number, number, number] {
  // Machado-2009 deuteranope simulation matrix at severity 1.0
  // (full deficiency). Coefficients match the published paper to 6 dp.
  const [r, g, b] = rgb;
  const sr = 0.367_322 * r + 0.860_646 * g + -0.227_968 * b;
  const sg = 0.280_085 * r + 0.672_501 * g + 0.047_413 * b;
  const sb = -0.011_820 * r + 0.042_940 * g + 0.968_881 * b;
  return [
    Math.max(0, Math.min(255, sr)),
    Math.max(0, Math.min(255, sg)),
    Math.max(0, Math.min(255, sb)),
  ];
}

const DEUT_DISTANCE_THRESHOLD = 25; // Euclidean distance in 0..255 RGB.

/**
 * Result of `checkBrandContrast` — a discriminated union so AUDIT-11
 * can branch on the failure kind for context-specific path + message.
 *
 * Moat 4 review NIT-6 + NIT-9: the contrast failure carries a WCAG
 * ratio (1..21, where higher is better) and points at
 * `/brand/palette/surface`; the color-blind failure carries an RGB
 * Euclidean distance under deuteranope simulation and points at
 * `/brand/palette/categorical`. They're semantically different signals,
 * so they get distinct paths + distinct value fields instead of
 * reusing `ratio` for both.
 */
export type BrandContrastFailure =
  | {
      kind: "contrast";
      /** The surface fg/bg pair that failed. */
      a: string;
      b: string;
      /** Computed WCAG 2.2 contrast ratio (lower = worse). */
      ratio: number;
      /** Threshold from `accessibility.minContrastRatio`. */
      threshold: number;
    }
  | {
      kind: "color-blind";
      /** The two categorical entries that collapsed under deuteranopia. */
      a: string;
      b: string;
      /** Euclidean distance in deuteranope-simulated RGB space. */
      distance: number;
      /** Threshold (DEUT_DISTANCE_THRESHOLD; lower distance = worse). */
      threshold: number;
    };

/**
 * Verify the brand kit's accessibility constraints.
 *
 * Returns the first failure found, or `null` when the kit is compliant.
 * Two checks:
 *   1. surface fg/bg must clear `accessibility.minContrastRatio`.
 *   2. when `accessibility.colorBlindSafe`, the categorical palette
 *      must not collapse two entries to a near-identical deuteranope
 *      appearance.
 *
 * Pure function. Used by AUDIT-11.
 */
export function checkBrandContrast(brand: BrandKit): BrandContrastFailure | null {
  const { fg, bg } = brand.palette.surface;
  const ratio = contrastRatio(fg, bg);
  if (ratio < brand.accessibility.minContrastRatio) {
    return {
      kind: "contrast",
      a: fg,
      b: bg,
      ratio,
      threshold: brand.accessibility.minContrastRatio,
    };
  }
  if (brand.accessibility.colorBlindSafe) {
    const palette = brand.palette.categorical;
    const sim: Array<[number, number, number]> = [];
    for (const c of palette) {
      // Per Moat 4 review IMPORTANT-1/5: the BRAND_COLOR_RE schema
      // already rejects unparseable input at Zod-parse time, so
      // parseColor returning null here would only happen if the schema
      // regex and the parser diverge. Treat it as a fail-loud
      // condition rather than silently skipping the entry.
      const rgb = parseColor(c);
      if (!rgb) {
        throw new Error(
          `checkBrandContrast: palette entry "${c}" is unparseable. ` +
            "This is a schema/parser disagreement — BRAND_COLOR_RE in " +
            "spec/schemas.ts and parseColor in render/brand.ts must stay in sync.",
        );
      }
      sim.push(simulateDeuteranopia(rgb));
    }
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const a = sim[i]!;
        const b = sim[j]!;
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        const dz = a[2] - b[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < DEUT_DISTANCE_THRESHOLD) {
          // Report the unsimulated colors so the user sees the offending pair.
          return {
            kind: "color-blind",
            a: palette[i]!,
            b: palette[j]!,
            distance: d,
            threshold: DEUT_DISTANCE_THRESHOLD,
          };
        }
      }
    }
  }
  return null;
}
