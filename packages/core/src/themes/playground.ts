/**
 * Joy of Math — playground preset BrandKit.
 *
 * Targets the 8-15 yo kid persona. Warm cream background, friendly
 * type stack with print/handwriting fallbacks, chunky strokes,
 * generous spacing. The categorical palette is the primary-toy ramp
 * with deuteranopia-safe pair distances (verified by AUDIT-11 via
 * the unit test in `presets.test.ts`).
 *
 * Resolved by the compiler when a spec sets `theme: "playground"`.
 */

import type { BrandKit } from "../spec/types.js";

export const PLAYGROUND_BRAND: BrandKit = {
  format: "glyph-brand/1",
  palette: {
    // Tailwind-derived primary-toy ramp. Purple (#a855f7) was dropped
    // because it collapses with blue (#3b82f6) under deuteranopia
    // simulation; pink (#ec4899) keeps the same "fun" feel while
    // surviving AUDIT-11's pair-distance check.
    categorical: ["#ef4444", "#3b82f6", "#facc15", "#22c55e", "#ec4899", "#f97316"],
    surface: {
      bg: "#fefce8", // warm cream
      fg: "#1f2937", // soft black
      muted: "#6b7280",
      border: "#e5e7eb",
    },
  },
  typography: {
    fontFamily: '"Comic Neue", "Segoe Print", system-ui, sans-serif',
    fontSize: 14,
    titleScale: 1.4,
  },
  spacing: { unit: 6, plotMargin: 5 },
  accessibility: { minContrastRatio: 4.5, colorBlindSafe: true },
};
