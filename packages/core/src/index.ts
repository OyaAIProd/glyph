/**
 * @glyph/core — public surface.
 *
 * Exports:
 *   - VERSION: package version constant
 *   - Spec types, schemas, and parsers (from ./spec/*)
 *   - Compute engine interface (from ./compute/*)
 *   - Compiler (spec + rows → scenegraph)
 *   - Scenegraph types (the IR consumed by renderers)
 *   - SVG renderer (Scene → SVG string)
 */
export const VERSION = "0.0.0";

export * from "./spec/index.js";
export * from "./compute/index.js";
export * from "./scenegraph/index.js";
export * from "./compiler/index.js";
export * from "./render/index.js";
export * from "./capabilities.js";
export * from "./vegalite/index.js";
export * from "./explain/index.js";
export * from "./diagnostics/index.js";
export * from "./metrics/index.js";
export * from "./geo/index.js";
export * from "./scales-suggest/index.js";
export * from "./spec-diff/index.js";
export * from "./audit/index.js";
export * from "./stats/index.js";
export * from "./layout/index.js";
export * from "./contour/index.js";
export * from "./interactions/index.js";
export * from "./story/index.js";
export { powScale, quantileScale, thresholdScale } from "./compiler/scales.js";
