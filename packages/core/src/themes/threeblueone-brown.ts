/**
 * Joy of Math — 3Blue1Brown-style preset BrandKit.
 *
 * Chalkboard background, the signature 3b1b blue as the primary
 * categorical, warm-yellow accent. Mono-ish serif typography
 * (Cardo / Computer Modern) evokes the LaTeX-rendered math you'd
 * see in a Grant Sanderson explainer.
 *
 * Both fg/bg contrast and deuteranopia pair distances are pinned by
 * a unit test in `presets.test.ts` so a tweak that breaks AUDIT-11
 * fails loudly.
 *
 * Resolved by the compiler when a spec sets `theme: "3b1b"`.
 */

import type { BrandKit } from "../spec/types.js";

export const THREEBLUEONE_BROWN_BRAND: BrandKit = {
  format: "glyph-brand/1",
  palette: {
    // E4 review IMPORTANT-2 fix — the original palette's `#fb7185`
    // pink vs `#34d399` green pair sat 29.05 units apart under
    // Machado-2009 deuteranopia (threshold 25), only 4 units of
    // headroom. Swapped the green to `#10b981` (a darker emerald)
    // which widens the min-pair distance to ~38, giving 13 units
    // of headroom. Palette pair invariant locked by the AUDIT-11
    // test in presets.test.ts; this widening just gives the agent
    // room to tweak without instantly breaking the gate.
    categorical: ["#3b6fb8", "#facc15", "#fb7185", "#10b981", "#a78bfa"],
    surface: {
      bg: "#1c2638", // chalkboard
      fg: "#e8e6df", // chalk white
      muted: "#94a3b8",
      border: "#334155",
    },
  },
  typography: {
    fontFamily: '"Cardo", "Computer Modern", Georgia, serif',
    fontSize: 14,
    titleScale: 1.3,
  },
  spacing: { unit: 5, plotMargin: 5 },
  accessibility: { minContrastRatio: 4.5, colorBlindSafe: true },
};
