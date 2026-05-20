// site/play/glyph-runtime.js
// Thin wrapper around the @glyph/core browser bundle. Exists so the
// playground (and any future browser caller) imports the
// `compileSpec` → `renderSvg` pipeline through a single, named entry
// point instead of reaching into glyph-bundle.js directly. Keeping the
// surface this small is what makes the "same inputs → same SVG bytes"
// claim auditable: there's nothing else between the user's spec and
// the rendered string.
import { compileSpec, renderSvg } from "./glyph-bundle.js";

/**
 * Compile a Glyph spec against rows + schema and return the SVG string.
 *
 * @param {object} spec   Parsed Glyph spec (object, not JSON text).
 * @param {Array<object>} rows  Tabular data, one row per object.
 * @param {Array<{name: string, type: string}>} schema  Column descriptors.
 * @returns {string} SVG markup. Caller is responsible for inserting it.
 */
export function compileAndRender(spec, rows, schema) {
  const scene = compileSpec({ spec, rows, schema });
  return renderSvg(scene);
}
