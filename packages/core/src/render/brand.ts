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
 *
 * Pure function — same input always returns the same Theme.
 */
export function brandKitToTheme(brand: BrandKit): ResolvedTheme {
  return {
    background: brand.palette.surface.bg,
    fg: brand.palette.surface.fg,
    axis: brand.palette.surface.muted,
    grid: brand.palette.surface.border,
    marks: brand.palette.categorical,
  };
}

/**
 * Merge an explicit `ThemeConfig` on top of a brand-derived theme.
 *
 * When a spec sets BOTH `brand:` and `theme:`, brand resolves first
 * and the explicit `theme:` keys override. This lets agents reuse a
 * brand kit but tweak (say) the grid color for one specific chart.
 */
export function mergeBrandWithTheme(brand: BrandKit, theme: ThemeConfig): ResolvedTheme {
  const base = brandKitToTheme(brand);
  return {
    background: theme.background ?? base.background,
    fg: theme.fg ?? base.fg,
    axis: theme.axis ?? base.axis,
    grid: theme.grid ?? base.grid,
    marks: theme.palette ?? base.marks,
  };
}

// ---------------------------------------------------------------------------
// WCAG contrast checking
//
// The standard relative luminance formula from WCAG 2.2 §1.4.3.
// `parseColor` accepts `#rgb`, `#rrggbb`, and the common `rgb(r,g,b)` /
// `rgba(r,g,b,a)` strings — enough to cover JSON-serializable brand kits.
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
// Brettel/Viénot/Mollon simulation matrix for deuteranopia (most common
// red-green color blindness). We project each RGB to its deuteranope
// appearance and flag palette entries that collapse to within
// `DEUT_DISTANCE_THRESHOLD` Euclidean distance in the simulated space.
// ---------------------------------------------------------------------------

/** Simulate the deuteranopia appearance of an sRGB color (0..255). */
export function simulateDeuteranopia(rgb: [number, number, number]): [number, number, number] {
  // Standard deuteranope simulation matrix (Machado et al. 2009 — severity 1.0)
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
export function checkBrandContrast(brand: BrandKit): {
  failing: { a: string; b: string; ratio: number };
} | null {
  const { fg, bg } = brand.palette.surface;
  const ratio = contrastRatio(fg, bg);
  if (ratio < brand.accessibility.minContrastRatio) {
    return { failing: { a: fg, b: bg, ratio } };
  }
  if (brand.accessibility.colorBlindSafe) {
    const palette = brand.palette.categorical;
    const sim: Array<[number, number, number]> = [];
    for (const c of palette) {
      const rgb = parseColor(c);
      if (!rgb) continue;
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
            failing: { a: palette[i]!, b: palette[j]!, ratio: d },
          };
        }
      }
    }
  }
  return null;
}
