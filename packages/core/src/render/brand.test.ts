/**
 * Moat PR4 — brand-kit resolution tests.
 *
 * Covers the pure-function brand-kit → Theme pipeline, the
 * brand-overrides-theme merge rule, the WCAG contrast helper, and
 * the deuteranopia simulation used by `colorBlindSafe`.
 */

import { describe, expect, it } from "vitest";
import type { BrandKit } from "../spec/types.js";
import {
  brandKitToTheme,
  checkBrandContrast,
  contrastRatio,
  mergeBrandWithTheme,
  parseColor,
  simulateDeuteranopia,
} from "./brand.js";

const baseBrand: BrandKit = {
  format: "glyph-brand/1",
  palette: {
    categorical: ["#1d4ed8", "#f59e0b", "#10b981", "#ef4444"],
    surface: {
      fg: "#0f172a",
      bg: "#ffffff",
      muted: "#64748b",
      border: "#e2e8f0",
    },
  },
  typography: {
    fontFamily: "Inter, sans-serif",
    fontSize: 13,
    titleScale: 1.2,
  },
  spacing: { unit: 4, plotMargin: 4 },
  accessibility: { minContrastRatio: 4.5 },
};

describe("brandKitToTheme", () => {
  it("maps surface + categorical tokens onto the flat Theme", () => {
    const theme = brandKitToTheme(baseBrand);
    expect(theme.background).toBe("#ffffff");
    expect(theme.fg).toBe("#0f172a");
    expect(theme.axis).toBe("#64748b");
    expect(theme.grid).toBe("#e2e8f0");
    expect(theme.marks).toEqual(["#1d4ed8", "#f59e0b", "#10b981", "#ef4444"]);
  });

  it("is pure — same input → same output", () => {
    const a = brandKitToTheme(baseBrand);
    const b = brandKitToTheme(baseBrand);
    expect(a).toEqual(b);
  });

  it("dark-mode swap only changes the surface block", () => {
    const dark: BrandKit = {
      ...baseBrand,
      palette: {
        ...baseBrand.palette,
        surface: {
          fg: "#f1f5f9",
          bg: "#0b1220",
          muted: "#94a3b8",
          border: "#1e293b",
        },
      },
    };
    const light = brandKitToTheme(baseBrand);
    const darkTheme = brandKitToTheme(dark);
    // Categorical palette is reused (composition!).
    expect(darkTheme.marks).toEqual(light.marks);
    // Surface tokens flipped.
    expect(darkTheme.background).toBe("#0b1220");
    expect(darkTheme.fg).toBe("#f1f5f9");
  });
});

describe("mergeBrandWithTheme — brand precedence", () => {
  it("brand wins for surface + palette when no theme override is set", () => {
    const merged = mergeBrandWithTheme(baseBrand, {
      // ThemeConfigSchema requires every field, so include defaults.
      background: baseBrand.palette.surface.bg,
      fg: baseBrand.palette.surface.fg,
      axis: baseBrand.palette.surface.muted,
      grid: baseBrand.palette.surface.border,
      palette: baseBrand.palette.categorical as string[],
    });
    expect(merged).toEqual(brandKitToTheme(baseBrand));
  });

  it("explicit theme overrides take priority over the brand-derived value", () => {
    const merged = mergeBrandWithTheme(baseBrand, {
      background: "#000000",
      fg: "#ff00ff",
      axis: "#222222",
      grid: "#333333",
      palette: ["#abcdef"],
    });
    expect(merged.background).toBe("#000000");
    expect(merged.fg).toBe("#ff00ff");
    expect(merged.marks).toEqual(["#abcdef"]);
  });
});

describe("contrastRatio (WCAG)", () => {
  it("white/black computes to ~21:1", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });

  it("identical colors compute to 1:1", () => {
    expect(contrastRatio("#7f7f7f", "#7f7f7f")).toBe(1);
  });

  it("is symmetric (a vs b == b vs a)", () => {
    expect(contrastRatio("#1d4ed8", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#1d4ed8"),
      6,
    );
  });

  it("clears 4.5:1 for the default brand surface", () => {
    expect(contrastRatio(baseBrand.palette.surface.fg, baseBrand.palette.surface.bg)).toBeGreaterThan(4.5);
  });

  it("handles #rgb short form and rgb() functional form", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 0);
    expect(contrastRatio("rgb(255,255,255)", "rgb(0,0,0)")).toBeCloseTo(21, 0);
  });
});

describe("parseColor", () => {
  it("returns null for unparseable input", () => {
    expect(parseColor("not-a-color")).toBeNull();
    expect(parseColor("#zzzzzz")).toBeNull();
  });

  it("parses #rrggbb", () => {
    expect(parseColor("#10b981")).toEqual([0x10, 0xb9, 0x81]);
  });
});

describe("checkBrandContrast", () => {
  it("returns null when the brand kit clears its own minContrastRatio", () => {
    expect(checkBrandContrast(baseBrand)).toBeNull();
  });

  it("flags a grey-on-grey surface as failing 4.5:1", () => {
    const bad: BrandKit = {
      ...baseBrand,
      palette: {
        ...baseBrand.palette,
        surface: { fg: "#888888", bg: "#999999", muted: "#aaa", border: "#bbb" },
      },
    };
    const result = checkBrandContrast(bad);
    expect(result).not.toBeNull();
    expect(result?.failing.a).toBe("#888888");
    expect(result?.failing.b).toBe("#999999");
    expect(result?.failing.ratio).toBeLessThan(4.5);
  });

  it("flags a deuteranopia-collapsing palette when colorBlindSafe=true", () => {
    // Two reds that look near-identical to a deuteranope.
    const colorBlindUnsafe: BrandKit = {
      ...baseBrand,
      palette: {
        ...baseBrand.palette,
        categorical: ["#ff0000", "#ff1100"],
      },
      accessibility: { minContrastRatio: 4.5, colorBlindSafe: true },
    };
    const result = checkBrandContrast(colorBlindUnsafe);
    expect(result).not.toBeNull();
  });

  it("does NOT flag a colorBlindSafe palette when entries stay distinct under simulation", () => {
    const safe: BrandKit = {
      ...baseBrand,
      palette: {
        ...baseBrand.palette,
        // Blue and yellow — both stay distinct under deuteranope simulation.
        categorical: ["#1d4ed8", "#f59e0b"],
      },
      accessibility: { minContrastRatio: 4.5, colorBlindSafe: true },
    };
    expect(checkBrandContrast(safe)).toBeNull();
  });
});

describe("simulateDeuteranopia", () => {
  it("clamps output into 0..255", () => {
    const [r, g, b] = simulateDeuteranopia([255, 255, 255]);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeLessThanOrEqual(255);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic", () => {
    expect(simulateDeuteranopia([200, 100, 50])).toEqual(simulateDeuteranopia([200, 100, 50]));
  });
});
