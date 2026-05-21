/**
 * Joy of Math E4 — preset BrandKit invariants.
 *
 * Both built-in kid-friendly presets MUST pass AUDIT-11 by
 * construction. These tests pin the WCAG contrast + deuteranopia
 * pair-distance checks so a future palette tweak that breaks them
 * fails loudly in CI before it ships.
 */
import { describe, expect, it } from "vitest";
import { checkBrandContrast } from "../render/brand.js";
import { PLAYGROUND_BRAND } from "./playground.js";
import { THREEBLUEONE_BROWN_BRAND } from "./threeblueone-brown.js";

describe("playground preset", () => {
  it("passes WCAG contrast + deuteranopia pair-distance checks", () => {
    expect(checkBrandContrast(PLAYGROUND_BRAND)).toBeNull();
  });

  it("declares the BrandKit v1 wire format", () => {
    expect(PLAYGROUND_BRAND.format).toBe("glyph-brand/1");
  });

  it("opts into AUDIT-11 deuteranopia checking", () => {
    expect(PLAYGROUND_BRAND.accessibility.colorBlindSafe).toBe(true);
  });
});

describe("3b1b preset", () => {
  it("passes WCAG contrast + deuteranopia pair-distance checks", () => {
    expect(checkBrandContrast(THREEBLUEONE_BROWN_BRAND)).toBeNull();
  });

  it("declares the BrandKit v1 wire format", () => {
    expect(THREEBLUEONE_BROWN_BRAND.format).toBe("glyph-brand/1");
  });

  it("opts into AUDIT-11 deuteranopia checking", () => {
    expect(THREEBLUEONE_BROWN_BRAND.accessibility.colorBlindSafe).toBe(true);
  });
});
