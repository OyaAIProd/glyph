/**
 * SVG renderer — Scene → SVG string.
 *
 * Pure function. No DOM, no jsdom. Deterministic: same Scene → same bytes.
 *
 * Output is intentionally compact: no whitespace between attributes, fixed
 * decimal precision (via the compiler's roundPx), and elements emitted in
 * a fixed order (axes, then marks).
 *
 * Interactive mode (opt-in via `scene.schema`):
 *   - Marks render inside a `<g class="glyph-marks" data-*>` group describing
 *     which source field each channel maps to.
 *   - Each mark gets `data-key` + `data-x` / `data-y` / `data-color` / `data-row`.
 *   - A tiny `<style>` block adds a `:hover` outline (zero JS, deterministic).
 *   - When `scene.schema` is absent, output is byte-identical to the
 *     non-interactive path so existing snapshots stay green.
 */

import type {
  MarkData,
  Scene,
  SceneAxis,
  SceneLegend,
  SceneMark,
  ScenePanel,
} from "../scenegraph/types.js";

const AXIS_COLOR = "#999999";
const AXIS_LABEL_COLOR = "#333333";
const GRID_COLOR = "#e6e6e6";
const FONT_FAMILY = "system-ui, -apple-system, sans-serif";

const HOVER_STYLE =
  "<style>.glyph-marks &gt; *{transition:filter .12s ease-out}.glyph-marks &gt; *:hover{filter:brightness(1.08);outline:1px solid #00000033;outline-offset:1px;cursor:pointer}</style>";

/**
 * Escape user-derived text for inclusion in SVG. Covers the five XML chars
 * plus stripping control characters (which are illegal in XML 1.0).
 */
function esc(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Strip illegal-in-XML control characters (kept: TAB \t, LF \n, CR \r).
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
    const ch = s[i];
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "'") out += "&apos;";
    else out += ch;
  }
  return out;
}

/** Render data-* attributes from MarkData. Deterministic ordering: key first, then sorted attrs. */
function renderDataAttrs(d: MarkData): string {
  let out = "";
  if (d.key !== undefined) out += ` data-key="${esc(d.key)}"`;
  const attrs = d.dataAttrs;
  if (attrs) {
    const keys = Object.keys(attrs).sort();
    for (const k of keys) {
      const v = attrs[k];
      if (v === undefined) continue;
      out += ` data-${k}="${esc(String(v))}"`;
    }
  }
  return out;
}

/** ARIA attributes for an interactive mark (reuses tooltip text as the label). */
function ariaForMark(m: { readonly tooltip?: string }): string {
  if (!m.tooltip) return ` role="button" tabindex="0"`;
  return ` role="button" tabindex="0" aria-label="${esc(m.tooltip)}"`;
}

function renderMark(m: SceneMark, interactive: boolean): string {
  switch (m.type) {
    case "rect": {
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      if (!interactive) {
        return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
          m.fill,
        )}"${stroke}${sw}/>`;
      }
      const data = renderDataAttrs(m);
      const aria = ariaForMark(m);
      const tooltip = m.tooltip ? `<title>${esc(m.tooltip)}</title>` : "";
      if (tooltip) {
        return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
          m.fill,
        )}"${stroke}${sw}${data}${aria}>${tooltip}</rect>`;
      }
      return `<rect x="${m.x}" y="${m.y}" width="${m.width}" height="${m.height}" fill="${esc(
        m.fill,
      )}"${stroke}${sw}${data}${aria}/>`;
    }
    case "circle": {
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      if (!interactive) {
        return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}/>`;
      }
      const data = renderDataAttrs(m);
      const aria = ariaForMark(m);
      const tooltip = m.tooltip ? `<title>${esc(m.tooltip)}</title>` : "";
      if (tooltip) {
        return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}${data}${aria}>${tooltip}</circle>`;
      }
      return `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}" fill="${esc(m.fill)}"${stroke}${sw}${data}${aria}/>`;
    }
    case "line":
      return `<line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="${esc(
        m.stroke,
      )}" stroke-width="${m.strokeWidth}"/>`;
    case "path": {
      const fill = m.fill !== undefined ? esc(m.fill) : "none";
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      const op = m.opacity !== undefined ? ` opacity="${m.opacity}"` : "";
      return `<path d="${m.d}" fill="${fill}"${stroke}${sw}${op}/>`;
    }
    case "text":
      return `<text x="${m.x}" y="${m.y}" font-size="${m.fontSize}" fill="${esc(
        m.fill,
      )}" text-anchor="${m.anchor}" dominant-baseline="${m.baseline}">${esc(m.text)}</text>`;
    case "arc": {
      // PR66 — pie / donut slice. Build the path inline so the renderer
      // has zero scenegraph→SVG transformation work other than emitting.
      const d = arcSvgPath(m.cx, m.cy, m.innerRadius, m.outerRadius, m.startAngle, m.endAngle);
      const stroke = m.stroke ? ` stroke="${esc(m.stroke)}"` : "";
      const sw = m.strokeWidth !== undefined ? ` stroke-width="${m.strokeWidth}"` : "";
      if (!interactive) {
        return `<path d="${d}" fill="${esc(m.fill)}"${stroke}${sw}/>`;
      }
      const data = renderDataAttrs(m);
      const aria = ariaForMark(m);
      const tooltip = m.tooltip ? `<title>${esc(m.tooltip)}</title>` : "";
      if (tooltip) {
        return `<path d="${d}" fill="${esc(m.fill)}"${stroke}${sw}${data}${aria}>${tooltip}</path>`;
      }
      return `<path d="${d}" fill="${esc(m.fill)}"${stroke}${sw}${data}${aria}/>`;
    }
  }
}

/**
 * PR66 — emit an SVG path-d string for one annular sector. The compiler
 * could pre-compute this, but keeping it in the renderer means the
 * scenegraph stays semantic (cx/cy/innerR/outerR/angles) rather than
 * a string blob — friendlier to other renderers (canvas/webgl).
 *
 * Angle convention: clockwise from 12-o'clock. We subtract π/2 here so
 * 0 rad points up.
 */
function arcSvgPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const a0 = startAngle - Math.PI / 2;
  const a1 = endAngle - Math.PI / 2;
  const sweep = endAngle - startAngle;
  const largeArc = sweep > Math.PI ? 1 : 0;
  const r = (n: number): number => Math.round(n * 1e8) / 1e8;
  const ox = (rad: number, a: number): number => r(cx + rad * Math.cos(a));
  const oy = (rad: number, a: number): number => r(cy + rad * Math.sin(a));
  if (sweep >= 2 * Math.PI - 1e-9) {
    // Full ring or disc.
    if (innerR <= 0) {
      return `M ${ox(outerR, a0)} ${oy(outerR, a0)} A ${r(outerR)} ${r(outerR)} 0 1 1 ${ox(outerR, a0 + Math.PI)} ${oy(outerR, a0 + Math.PI)} A ${r(outerR)} ${r(outerR)} 0 1 1 ${ox(outerR, a0)} ${oy(outerR, a0)} Z`;
    }
    return `M ${ox(outerR, a0)} ${oy(outerR, a0)} A ${r(outerR)} ${r(outerR)} 0 1 1 ${ox(outerR, a0 + Math.PI)} ${oy(outerR, a0 + Math.PI)} A ${r(outerR)} ${r(outerR)} 0 1 1 ${ox(outerR, a0)} ${oy(outerR, a0)} Z M ${ox(innerR, a0)} ${oy(innerR, a0)} A ${r(innerR)} ${r(innerR)} 0 1 0 ${ox(innerR, a0 + Math.PI)} ${oy(innerR, a0 + Math.PI)} A ${r(innerR)} ${r(innerR)} 0 1 0 ${ox(innerR, a0)} ${oy(innerR, a0)} Z`;
  }
  if (innerR <= 0) {
    return `M ${r(cx)} ${r(cy)} L ${ox(outerR, a0)} ${oy(outerR, a0)} A ${r(outerR)} ${r(outerR)} 0 ${largeArc} 1 ${ox(outerR, a1)} ${oy(outerR, a1)} Z`;
  }
  return `M ${ox(innerR, a0)} ${oy(innerR, a0)} L ${ox(outerR, a0)} ${oy(outerR, a0)} A ${r(outerR)} ${r(outerR)} 0 ${largeArc} 1 ${ox(outerR, a1)} ${oy(outerR, a1)} L ${ox(innerR, a1)} ${oy(innerR, a1)} A ${r(innerR)} ${r(innerR)} 0 ${largeArc} 0 ${ox(innerR, a0)} ${oy(innerR, a0)} Z`;
}

function renderAxis(axis: SceneAxis): string {
  const parts: string[] = [];
  const { origin, length } = axis;

  if (axis.orientation === "bottom") {
    parts.push(
      `<line x1="${origin.x}" y1="${origin.y}" x2="${origin.x + length}" y2="${
        origin.y
      }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );
    for (const t of axis.ticks) {
      parts.push(
        `<line x1="${t.position}" y1="${origin.y}" x2="${t.position}" y2="${
          origin.y + 4
        }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${t.position}" y="${
          origin.y + 16
        }" font-family="${FONT_FAMILY}" font-size="11" fill="${AXIS_LABEL_COLOR}" text-anchor="middle" dominant-baseline="hanging">${esc(t.label)}</text>`,
      );
    }
    if (axis.label) {
      parts.push(
        `<text x="${origin.x + length / 2}" y="${
          origin.y + 32
        }" font-family="${FONT_FAMILY}" font-size="12" fill="${AXIS_LABEL_COLOR}" text-anchor="middle" dominant-baseline="hanging">${esc(axis.label)}</text>`,
      );
    }
  } else if (axis.orientation === "left") {
    parts.push(
      `<line x1="${origin.x}" y1="${origin.y}" x2="${origin.x}" y2="${
        origin.y + length
      }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );
    for (const t of axis.ticks) {
      parts.push(
        `<line x1="${origin.x - 4}" y1="${t.position}" x2="${
          origin.x
        }" y2="${t.position}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${origin.x - 8}" y="${
          t.position
        }" font-family="${FONT_FAMILY}" font-size="11" fill="${AXIS_LABEL_COLOR}" text-anchor="end" dominant-baseline="middle">${esc(t.label)}</text>`,
      );
    }
    if (axis.label) {
      parts.push(
        `<text x="${origin.x - 40}" y="${
          origin.y + length / 2
        }" font-family="${FONT_FAMILY}" font-size="12" fill="${AXIS_LABEL_COLOR}" text-anchor="middle" dominant-baseline="alphabetic" transform="rotate(-90 ${origin.x - 40} ${origin.y + length / 2})">${esc(axis.label)}</text>`,
      );
    }
  } else {
    // right axis — labels live to the right of the tick line
    parts.push(
      `<line x1="${origin.x}" y1="${origin.y}" x2="${origin.x}" y2="${
        origin.y + length
      }" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );
    for (const t of axis.ticks) {
      parts.push(
        `<line x1="${origin.x}" y1="${t.position}" x2="${
          origin.x + 4
        }" y2="${t.position}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${origin.x + 8}" y="${
          t.position
        }" font-family="${FONT_FAMILY}" font-size="11" fill="${AXIS_LABEL_COLOR}" text-anchor="start" dominant-baseline="middle">${esc(t.label)}</text>`,
      );
    }
    if (axis.label) {
      parts.push(
        `<text x="${origin.x + 40}" y="${
          origin.y + length / 2
        }" font-family="${FONT_FAMILY}" font-size="12" fill="${AXIS_LABEL_COLOR}" text-anchor="middle" dominant-baseline="alphabetic" transform="rotate(90 ${origin.x + 40} ${origin.y + length / 2})">${esc(axis.label)}</text>`,
      );
    }
  }
  return parts.join("");
}

/**
 * Render grid lines for an axis's `gridTicks` across the plot area.
 *
 * For a left axis (`gridTicks` y positions): emit horizontal lines that span
 * the full plot width. Drawn at low contrast (#e6e6e6) and *before* marks so
 * they sit behind the data. Right-side gridTicks aren't drawn — they would
 * duplicate the left-side grid.
 */
function renderGrid(scene: Scene): string {
  const left = scene.axes.find((a) => a.orientation === "left");
  if (!left || !left.gridTicks || left.gridTicks.length === 0) return "";
  const pa = scene.plotArea;
  const lines: string[] = [];
  for (const t of left.gridTicks) {
    lines.push(
      `<line x1="${pa.x}" y1="${t.position}" x2="${pa.x + pa.width}" y2="${
        t.position
      }" stroke="${GRID_COLOR}" stroke-width="1"/>`,
    );
  }
  return lines.join("");
}

/** Render a color legend. */
function renderLegend(legend: SceneLegend): string {
  const { origin, entries, title } = legend;
  const rowH = 18;
  const swatch = 10;
  const parts: string[] = [];
  parts.push(
    `<text x="${origin.x}" y="${
      origin.y
    }" font-family="${FONT_FAMILY}" font-size="11" font-weight="600" fill="${AXIS_LABEL_COLOR}" text-anchor="start" dominant-baseline="hanging">${esc(title)}</text>`,
  );
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) continue;
    const y = origin.y + 16 + i * rowH;
    parts.push(
      `<rect x="${origin.x}" y="${y}" width="${swatch}" height="${swatch}" fill="${esc(
        e.color,
      )}"/>`,
    );
    parts.push(
      `<text x="${origin.x + swatch + 6}" y="${y + swatch / 2}" font-family="${FONT_FAMILY}" font-size="11" fill="${AXIS_LABEL_COLOR}" text-anchor="start" dominant-baseline="middle">${esc(e.label)}</text>`,
    );
  }
  return parts.join("");
}

/** Render scene-level data-* attributes (channel→field map + handle). */
function renderSceneAttrs(scene: Scene): string {
  const s = scene.schema;
  if (!s) return "";
  let out = "";
  const keys = Object.keys(s.fields).sort();
  for (const k of keys) {
    const f = s.fields[k];
    if (f) out += ` data-${k}-field="${esc(f)}"`;
  }
  if (s.handleId) out += ` data-handle="${esc(s.handleId)}"`;
  // PR77 (D3 Gap 8) — declarative interaction hooks. `@glyph/live` keys
  // on these attrs to attach the right hydration handlers.
  if (s.zoomable === true) out += ` data-glyph-zoom="true"`;
  if (s.lassoable === true) out += ` data-glyph-lasso="true"`;
  if (s.voronoiHover === true) out += ` data-glyph-voronoi="true"`;
  return out;
}

/**
 * Render a Scene as an SVG document string.
 */
/**
 * Render one facet panel: title text + the panel's axes + marks.
 * Coordinates are already absolute; the renderer just emits them.
 */
function renderPanel(p: ScenePanel, interactive: boolean): string {
  const titleStr = `<text x="${p.titleX}" y="${p.titleY}" font-family="${FONT_FAMILY}" font-size="12" font-weight="600" fill="${AXIS_LABEL_COLOR}" text-anchor="middle" dominant-baseline="alphabetic">${esc(
    p.title,
  )}</text>`;
  const axes = p.axes.map(renderAxis).join("");
  const markStrs = p.marks.map((m) => renderMark(m, interactive)).join("");
  const marks = interactive ? `<g class="glyph-marks">${markStrs}</g>` : markStrs;
  return `${titleStr}${marks}${axes}`;
}

export function renderSvg(scene: Scene): string {
  const interactive = scene.schema !== undefined;
  const rootAttrs = renderSceneAttrs(scene);
  // ARIA — SVG is an image with a title + description. Screen readers
  // announce these. Without an aria-label, NVDA / VoiceOver treat the
  // whole SVG as anonymous.
  const ariaLabel = scene.title ? ` aria-label="${esc(scene.title)}"` : ` aria-label="Glyph chart"`;
  const ariaRole = ` role="img"`;
  const ariaDesribedBy = ` aria-describedby="glyph-desc"`;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}"${ariaRole}${ariaLabel}${ariaDesribedBy}${rootAttrs}>`;
  // Hidden <desc> for screen-reader-only description.
  const desc = `<desc id="glyph-desc">${esc(scene.title ?? "Glyph chart")}</desc>`;
  const bg = `<rect x="0" y="0" width="${scene.width}" height="${scene.height}" fill="${esc(scene.background)}"/>`;
  const title = scene.title
    ? `<text x="${scene.width / 2}" y="16" font-family="${FONT_FAMILY}" font-size="14" fill="#1a1a1a" text-anchor="middle" dominant-baseline="middle">${esc(
        scene.title,
      )}</text>`
    : "";
  const hoverStyle = interactive ? HOVER_STYLE : "";
  // PR43 + PR45: opt-in animation. Three CSS-driven kinds (stage,
  // stage-stagger) and two SMIL-driven kinds (race, scrub).
  const animationStyle = buildAnimationStyle(scene);
  // PR61 — uncertainty overlay (defs + hatch + badge) + style for point
  // dimming. Both are "" when scene.uncertainty is unset.
  const uncertaintyStyle = buildUncertaintyStyle(scene);
  const uncertaintyOverlay = renderUncertaintyOverlay(scene);
  const legends = (scene.legends ?? []).map(renderLegend).join("");

  // Faceted scene: render each panel; the top-level marks/axes/grid are
  // unused (panels carry their own).
  if (scene.panels && scene.panels.length > 0) {
    const panelStrs = scene.panels.map((p) => renderPanel(p, interactive)).join("");
    return `${head}${desc}${hoverStyle}${uncertaintyStyle}${bg}${title}${panelStrs}${uncertaintyOverlay}${legends}</svg>\n`;
  }

  // Grid sits behind marks; axes + legends in front.
  const grid = renderGrid(scene);
  const animKind = scene.animation?.kind;
  // Per-mark rendering. For stage-stagger, each mark carries an inline
  // `style="animation-delay:Nms"` driven by row index. For race/scrub,
  // each mark hosts a SMIL <animate> child built from scene.animation.frames.
  const stagger =
    animKind === "stage-stagger"
      ? ((scene.animation as { stagger_ms?: number }).stagger_ms ?? 60)
      : 0;
  const markStrs = scene.marks
    .map((m, i) => decorateMarkForAnimation(renderMark(m, interactive), i, scene, stagger))
    .join("");
  const animClass =
    animKind === "stage"
      ? " glyph-stage"
      : animKind === "stage-stagger"
        ? " glyph-stage-stagger"
        : animKind === "race" || animKind === "scrub"
          ? " glyph-race"
          : "";
  // PR61 — append a `glyph-uncertain` marker class when dimPoints fires.
  const uncertainClass = scene.uncertainty?.dimPoints ? " glyph-uncertain" : "";
  const marks =
    interactive || animClass || uncertainClass
      ? `<g class="glyph-marks${animClass}${uncertainClass}">${markStrs}</g>`
      : markStrs;
  const axes = scene.axes.map(renderAxis).join("");
  return `${head}${desc}${hoverStyle}${animationStyle}${uncertaintyStyle}${bg}${title}${grid}${marks}${axes}${uncertaintyOverlay}${legends}</svg>\n`;
}

/**
 * Build the <style> block for the scene's animation. CSS kinds (stage,
 * stage-stagger) emit @keyframes; SMIL kinds (race, scrub) animate inline
 * and need no style block.
 */
/**
 * PR61 (PLAN item 2.3) — render the optional uncertainty overlay.
 *
 * When `scene.uncertainty` is set, emits up to three additional fragments:
 *   1. A `<defs>` block with a 45° hatch `<pattern>` (only when hatchBars).
 *   2. A translucent hatch overlay covering the plot area (visual cue).
 *   3. A small top-right "n=… · confidence: …" badge.
 *
 * The marks group also gains a `glyph-uncertain` class when `dimPoints`
 * is true, so a tiny `<style>` rule can fade circles without dimming bars.
 *
 * Snapshot byte-identity: when `scene.uncertainty` is undefined (the
 * default for every existing snapshot), this function returns "".
 */
function renderUncertaintyOverlay(scene: Scene): string {
  const u = scene.uncertainty;
  if (!u) return "";
  const parts: string[] = [];
  if (u.hatchBars) {
    parts.push(
      '<defs><pattern id="glyph-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">' +
        '<line x1="0" y1="0" x2="0" y2="6" stroke="#444" stroke-width="1" stroke-opacity="0.35"/></pattern></defs>',
    );
    const pa = scene.plotArea;
    parts.push(
      `<rect x="${pa.x}" y="${pa.y}" width="${pa.width}" height="${pa.height}" fill="url(#glyph-hatch)" pointer-events="none" class="glyph-uncertainty-hatch"/>`,
    );
  }
  const badgeText = u.note ?? `n=${u.sampleRows} · confidence: ${u.confidence}`;
  const bx = scene.width - 8;
  const by = 14;
  parts.push(
    `<text x="${bx}" y="${by}" font-family="${FONT_FAMILY}" font-size="11" fill="#666" text-anchor="end" dominant-baseline="middle" class="glyph-uncertainty-badge">${esc(badgeText)}</text>`,
  );
  return parts.join("");
}

/** PR61 — extra style block applied when uncertainty.dimPoints fires. */
function buildUncertaintyStyle(scene: Scene): string {
  const u = scene.uncertainty;
  if (!u || !u.dimPoints) return "";
  return "<style>g.glyph-marks.glyph-uncertain circle{opacity:0.55}</style>";
}

function buildAnimationStyle(scene: Scene): string {
  const a = scene.animation;
  if (!a) return "";
  if (a.kind === "stage") {
    return `<style>@keyframes glyph-stage{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.glyph-stage{animation:glyph-stage ${a.duration_ms}ms ease-out both;transform-box:fill-box;transform-origin:center}</style>`;
  }
  if (a.kind === "stage-stagger") {
    return `<style>@keyframes glyph-stage-stagger{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}.glyph-stage-stagger>*{animation:glyph-stage-stagger ${a.duration_ms}ms ease-out both;transform-box:fill-box;transform-origin:center;opacity:0}</style>`;
  }
  return "";
}

/**
 * Decorate a mark's SVG markup for animation:
 *   - stage-stagger: inject `style="animation-delay:Nms"` based on row index.
 *   - race / scrub: inject a child <animate values="..."> driving the mark's
 *     animated attribute (width for rect, r for circle).
 * Falls through unchanged for stage and no-animation specs.
 */
/**
 * Frame-export helper (PR45). Given a scene with a `race` or `scrub`
 * animation, emit one SVG string per frame — each frame substitutes the
 * mark values for that frame. Useful for stitching an MP4/GIF outside the
 * renderer, or for snapshot-testing per-frame state in CI.
 *
 * For non-animated scenes this returns a single-element array with the
 * scene's regular render.
 */
export function renderFrames(scene: Scene): ReadonlyArray<string> {
  const a = scene.animation;
  if (!a || (a.kind !== "race" && a.kind !== "scrub")) {
    return [renderSvg(scene)];
  }
  return a.frames.map((frame) => {
    // Strip the animation field via destructure so the per-frame scene is
    // a plain static Scene.
    const { animation: _animation, ...rest } = scene;
    const frameScene: Scene = {
      ...rest,
      marks: scene.marks.map((m, i) => {
        const v = frame.values[i];
        if (v === undefined) return m;
        if (m.type === "rect") return { ...m, width: v };
        if (m.type === "circle") return { ...m, r: v };
        return m;
      }),
      title: `${scene.title ? `${scene.title} — ` : ""}${a.frame_field}=${frame.label}`,
    };
    return renderSvg(frameScene);
  });
}

function decorateMarkForAnimation(
  svgFragment: string,
  index: number,
  scene: Scene,
  stagger: number,
): string {
  const a = scene.animation;
  if (!a) return svgFragment;
  if (a.kind === "stage-stagger") {
    const delay = index * stagger;
    return svgFragment.replace(
      /<(rect|circle|line|path|text)\b/,
      (m) => `${m} style="animation-delay:${delay}ms"`,
    );
  }
  if (a.kind === "race" || a.kind === "scrub") {
    const m = scene.marks[index];
    if (!m) return svgFragment;
    const dur = a.duration_ms;
    if (m.type === "rect") {
      const values = a.frames.map((f) => String(f.values[index] ?? 0)).join(";");
      const animate = `<animate attributeName="width" values="${values}" dur="${dur}ms" repeatCount="indefinite"/>`;
      return svgFragment.replace(/<rect\b([^/]*)\/>/, `<rect$1>${animate}</rect>`);
    }
    if (m.type === "circle") {
      const values = a.frames.map((f) => String(f.values[index] ?? 0)).join(";");
      const animate = `<animate attributeName="r" values="${values}" dur="${dur}ms" repeatCount="indefinite"/>`;
      return svgFragment.replace(/<circle\b([^/]*)\/>/, `<circle$1>${animate}</circle>`);
    }
    return svgFragment;
  }
  if (a.kind === "morph") {
    // PR74 (D3 Gap 3) — interpolate geometric attrs between fromMarks[i]
    // and marks[i]. Single transition (no loop) so the chart settles in
    // the "to" state after one duration_ms. fill="freeze" pins the end.
    const to = scene.marks[index];
    const from = a.fromMarks[index];
    if (!to || !from) return svgFragment;
    const dur = a.duration_ms;
    const ms = `${dur}ms`;
    const animate = (attr: string, fromVal: number, toVal: number): string =>
      `<animate attributeName="${attr}" from="${fromVal}" to="${toVal}" dur="${ms}" fill="freeze"/>`;
    // Inject `anims` as children of the mark element. Handles BOTH:
    //   self-closing: `<rect ATTRS/>`         → `<rect ATTRS>anims</rect>`
    //   open + close: `<rect ATTRS>kids</rect>` → `<rect ATTRS>animskids</rect>`
    // The latter happens whenever the mark has a tooltip (which is
    // emitted as a <title> child by the interactive path). Without
    // this, tooltipped marks silently skip animation (PR74 review
    // critical finding).
    const injectChild = (tag: string, anims: string): string => {
      const selfClose = new RegExp(`<${tag}\\b([^>]*?)/>`);
      if (selfClose.test(svgFragment)) {
        return svgFragment.replace(selfClose, `<${tag}$1>${anims}</${tag}>`);
      }
      const open = new RegExp(`<${tag}\\b([^>]*)>`);
      return svgFragment.replace(open, `<${tag}$1>${anims}`);
    };
    if (to.type === "rect" && from.type === "rect") {
      const anims =
        animate("x", from.x, to.x) +
        animate("y", from.y, to.y) +
        animate("width", from.width, to.width) +
        animate("height", from.height, to.height);
      return injectChild("rect", anims);
    }
    if (to.type === "circle" && from.type === "circle") {
      const anims =
        animate("cx", from.cx, to.cx) + animate("cy", from.cy, to.cy) + animate("r", from.r, to.r);
      return injectChild("circle", anims);
    }
    if (to.type === "line" && from.type === "line") {
      const anims =
        animate("x1", from.x1, to.x1) +
        animate("y1", from.y1, to.y1) +
        animate("x2", from.x2, to.x2) +
        animate("y2", from.y2, to.y2);
      return injectChild("line", anims);
    }
    return svgFragment;
  }
  return svgFragment;
}
