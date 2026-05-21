/**
 * Joy of Math PR E2 — `mark: "traveler"`.
 *
 * A dot that traces a path mark over time via SMIL `<animateMotion>`.
 * Kids watch the moving dot more than the curve itself; that's the
 * delight unlock. Compositionally tiny: the traveler doesn't need its
 * own data — it references a sibling line layer by `id` and rides
 * that polyline.
 *
 * Spec shape (canonical use):
 * ```jsonc
 * {
 *   "layers": [
 *     { "id": "sine-curve", "mark": "line",
 *       "encoding": { "x": "x", "y": "y" } },
 *     { "mark": "traveler",
 *       "encoding": { "x": "x", "y": "y" },
 *       "traveler": {
 *         "follow": { "layerId": "sine-curve" },
 *         "duration_ms": 4000,
 *         "radius": 5,
 *         "trail": { "length": 0.2, "fade": true }
 *       } }
 *   ]
 * }
 * ```
 *
 * --- Pipeline ---
 * 1. Resolve the followed layer. `"self"` → the traveler's own
 *    encoding-projected polyline. `{layerId}` → look up the sibling
 *    layer by `id` in `spec.layers` and project its x/y encoding
 *    through the shared scales.
 * 2. Build the polyline string `"M x0 y0 L x1 y1 …"` deterministically
 *    via `roundPx`.
 * 3. Emit a `path` SceneMark with `stroke="none"`, `fill="none"`, and
 *    `id="traveler-path-<idx>"` — the path is invisible but addressable.
 * 4. Emit a `circle` SceneMark at the polyline's first point with the
 *    `motion: { pathId, durationMs }` attribute. The SVG renderer
 *    expands `motion` into an `<animateMotion><mpath/></animateMotion>`
 *    child.
 * 5. If `trail` is set, emit K extra circles where K =
 *    round(N * trail.length) and N is the configured polyline sample
 *    count. Each trail circle has a small `beginMs` offset so the tail
 *    trails behind the head. When `fade: true`, opacity ramps from
 *    0.10 (tail) → 0.65 (closest trail) → 1.0 (head). The head sits
 *    at full opacity to read clearly against the path stroke.
 *
 * --- Determinism ---
 * The path geometry is built by the same `roundPx`-guarded projection
 * helpers every line mark uses. The animateMotion durations are
 * integer milliseconds. Same spec → same bytes.
 *
 * --- Composition gotchas ---
 *   - When the followed path also has `animation.kind: "draw-in"`,
 *     the path is initially hidden (stroke-dashoffset = length) but
 *     the traveler's head begins moving at t=0. Viewers see the dot
 *     "floating" until the wave catches up. v0 documents this; a
 *     future PR could gate the traveler's begin on the draw-in's
 *     completion.
 *   - Trail circles each carry their OWN animateMotion with a
 *     `begin="-Nms"` offset. Per SMIL, each restarts at (t - begin)
 *     mod dur — so when the head wraps the loop, trail circles wrap
 *     at slightly different moments. The visible effect is a single
 *     "frame skip" once per loop; imperceptible at small
 *     trail.length but worth flagging.
 *
 * --- v0 limitations ---
 *   - Only follows `line`-shaped layers (`mark: "line"`); a future PR
 *     can teach it to follow `area`, `path`-emitting math curves, or
 *     trajectories with their natural insertion order.
 *   - No deceleration / easing on the dot itself; the dot moves at
 *     constant speed along the path. SMIL `<animateMotion>` supports
 *     `keyTimes` / `keySplines`, deferred until a use-case asks.
 */
import type { SceneMark } from "../../scenegraph/types.js";
import type { GlyphSpec } from "../../spec/types.js";
import { type MarkCompileArgs, type MarkCompiler, registerMark } from "../mark-registry.js";
import { roundPx } from "../scales.js";

/** Default head color → first theme palette entry. */
const DEFAULT_RADIUS_FALLBACK = 4;
/** Default animation duration when neither layer nor spec sets one. */
const DEFAULT_DURATION_MS = 4000;
/** Trail fade opacity bounds (tail → head). */
const TRAIL_FADE_MIN = 0.1;
const TRAIL_FADE_MAX = 0.7;

interface TravelerOptions {
  readonly follow: "self" | { layerId: string };
  readonly durationMs: number;
  readonly radius: number;
  readonly color: string;
  readonly trail: { length: number; fade: boolean } | undefined;
  readonly id: string | undefined;
}

function readOptions(
  layer: unknown,
  specAnimationDurMs: number | undefined,
  themeFirstPalette: string,
): TravelerOptions | undefined {
  if (typeof layer !== "object" || layer === null) return undefined;
  const t = (layer as { traveler?: unknown }).traveler;
  if (typeof t !== "object" || t === null) return undefined;
  const tr = t as Record<string, unknown>;
  // Resolve `follow`.
  let follow: TravelerOptions["follow"];
  if (tr.follow === "self") {
    follow = "self";
  } else if (typeof tr.follow === "object" && tr.follow !== null) {
    const f = tr.follow as { layerId?: unknown };
    if (typeof f.layerId === "string" && f.layerId.length > 0) {
      follow = { layerId: f.layerId };
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
  const durationMs =
    typeof tr.duration_ms === "number" && tr.duration_ms > 0
      ? tr.duration_ms
      : (specAnimationDurMs ?? DEFAULT_DURATION_MS);
  const radius =
    typeof tr.radius === "number" && tr.radius > 0 ? tr.radius : DEFAULT_RADIUS_FALLBACK;
  const color = typeof tr.color === "string" ? tr.color : themeFirstPalette;
  let trail: TravelerOptions["trail"];
  if (typeof tr.trail === "object" && tr.trail !== null) {
    const tt = tr.trail as Record<string, unknown>;
    const length = typeof tt.length === "number" ? tt.length : 0.15;
    const fade = typeof tt.fade === "boolean" ? tt.fade : true;
    trail = { length, fade };
  }
  const id = typeof tr.id === "string" ? tr.id : undefined;
  return { follow, durationMs, radius, color, trail, id };
}

/**
 * Extract spec.animation.duration_ms when present; tolerates every
 * animation kind by reading the field shape-agnostically. Returns
 * undefined when no chart-level animation is set.
 */
function specAnimationDurationMs(spec: GlyphSpec): number | undefined {
  const a = spec.animation as { duration_ms?: unknown } | undefined;
  if (a && typeof a.duration_ms === "number" && a.duration_ms > 0) {
    return a.duration_ms;
  }
  return undefined;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  return Number(v);
}

/**
 * Look up a sibling layer by `id`. Reads both the top-level
 * `layer.id` and the `traveler.id` alias so callers can use either
 * convention.
 */
function findLayerById(spec: GlyphSpec, layerId: string): GlyphSpec["layers"][number] | undefined {
  for (const l of spec.layers) {
    const direct = (l as { id?: unknown }).id;
    if (typeof direct === "string" && direct === layerId) return l;
    const t = (l as { traveler?: { id?: unknown } }).traveler;
    if (t && typeof t.id === "string" && t.id === layerId) return l;
  }
  return undefined;
}

/**
 * Project an x/y encoded layer's rows into pixel polyline coordinates.
 * Mirrors the geometry path of `buildLines` minus the missing-data
 * branches and color grouping (the traveler always rides one
 * polyline, even when the followed layer has color groups — picking
 * the first one keeps the kid-mode experience simple).
 *
 * Returns `undefined` when the resolution fails so callers can bail
 * cleanly without emitting half a scene.
 */
function projectPolyline(
  args: MarkCompileArgs,
  followedLayer: GlyphSpec["layers"][number],
): ReadonlyArray<{ x: number; y: number }> | undefined {
  const { rows, schema, xScale, yScale } = args;
  if (!yScale) return undefined;
  const enc = followedLayer.encoding;
  const xField =
    typeof enc.x === "string"
      ? enc.x
      : typeof enc.x === "object" && enc.x !== null && "field" in enc.x
        ? (enc.x as { field?: unknown }).field
        : undefined;
  const yField =
    typeof enc.y === "string"
      ? enc.y
      : typeof enc.y === "object" && enc.y !== null && "field" in enc.y
        ? (enc.y as { field?: unknown }).field
        : undefined;
  if (typeof xField !== "string" || typeof yField !== "string") return undefined;
  const xIdx = schema.findIndex((c) => c.name === xField);
  const yIdx = schema.findIndex((c) => c.name === yField);
  if (xIdx < 0 || yIdx < 0) return undefined;

  // Match the line-mark sort behavior. Parametric / trajectory data
  // arrives via the inline sentinel sources; we preserve insertion
  // order in those cases so closed orbits / Lissajous figures don't
  // collapse into zigzags. For ordinary tabular data we sort by x.
  const dataBlock = args.spec.data as { source?: unknown } | undefined;
  const dataSource = dataBlock && typeof dataBlock === "object" ? dataBlock.source : undefined;
  const preserveOrder =
    dataSource === "<inline:function-parametric>" || dataSource === "<inline:trajectory>";

  const pts: Array<{ x: number; y: number }> = [];
  for (const row of rows) {
    if (!row) continue;
    const xv = row[xIdx];
    const yv = row[yIdx];
    const yNum = num(yv);
    if (yv === null || yv === undefined || !Number.isFinite(yNum)) continue;
    const xpx =
      xScale.type === "linear"
        ? xScale.apply(num(xv))
        : xScale.apply(xv == null ? "" : String(xv)) + xScale.bandwidth / 2;
    if (!Number.isFinite(xpx)) continue;
    const ypx = yScale.apply(yNum);
    if (!Number.isFinite(ypx)) continue;
    pts.push({ x: roundPx(xpx), y: roundPx(ypx) });
  }
  if (!preserveOrder) pts.sort((a, b) => a.x - b.x);
  return pts;
}

/** Build the SVG `d` attribute string from a polyline. */
function polylineToD(pts: ReadonlyArray<{ x: number; y: number }>): string {
  if (pts.length === 0) return "";
  const first = pts[0];
  if (!first) return "";
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    d += ` L ${p.x} ${p.y}`;
  }
  return d;
}

/**
 * Stable per-spec traveler index. Used to generate the path id when
 * the layer doesn't provide one. We count traveler layers up to (but
 * not including) the current layer so two traveler layers in the
 * same spec get distinct ids.
 */
function travelerIndex(spec: GlyphSpec, layer: GlyphSpec["layers"][number]): number {
  let idx = 0;
  for (const l of spec.layers) {
    if (l === layer) return idx;
    if (l.mark === "traveler") idx++;
  }
  return idx;
}

export const travelerMarkCompiler: MarkCompiler = {
  type: "traveler",
  compile(args: MarkCompileArgs): void {
    const { layer, spec, theme, out } = args;
    const themeFirst = theme.marks[0] ?? "#000";
    const opts = readOptions(layer, specAnimationDurationMs(spec), themeFirst);
    if (!opts) return;

    // Resolve the followed layer. `"self"` is the easy case; the
    // sibling-by-id lookup throws when the id is unknown so agents
    // get a real compile error instead of a silent no-op (math-text
    // PR4 review IMPORTANT-2 set the precedent).
    let followedLayer: GlyphSpec["layers"][number];
    if (opts.follow === "self") {
      followedLayer = layer;
    } else {
      const found = findLayerById(spec, opts.follow.layerId);
      if (!found) {
        throw new Error(
          `traveler: follow.layerId="${opts.follow.layerId}" not found in spec.layers. Either add an 'id' field to the target layer or switch to 'follow: "self"'.`,
        );
      }
      followedLayer = found;
    }

    const polyline = projectPolyline(args, followedLayer);
    if (!polyline) {
      // E2 review IMPORTANT — same I1/I2 precedent the unknown-layerId
      // case follows: throw instead of silently emitting nothing when
      // the target layer can't project a path. The most common cause
      // is the followed layer lacking x/y encoding (e.g. following an
      // annotation layer, or a degenerate layer with empty rows).
      const tgtId = opts.follow === "self" ? "self" : opts.follow.layerId;
      throw new Error(
        `traveler: target layer '${tgtId}' has no x/y encoding to project, ` +
          "or its rows produced no finite points. Only line-shaped layers " +
          "(line/area/point with x+y encoding) can be followed.",
      );
    }
    if (polyline.length < 2) {
      // Polyline projected but has fewer than 2 points — same as the
      // missing-encoding case but happens when rows are empty. Same
      // diagnostic so the agent's debug path is consistent.
      const tgtId = opts.follow === "self" ? "self" : opts.follow.layerId;
      throw new Error(
        `traveler: target layer '${tgtId}' projected only ${polyline.length} ` +
          "finite point(s); need at least 2 for a path the head can follow.",
      );
    }
    const d = polylineToD(polyline);
    if (d.length === 0) return;

    // Stable path id. Prefer the explicit layer / traveler-config id
    // when provided; otherwise generate `traveler-path-N` where N
    // counts traveler layers in spec order.
    const explicitId =
      typeof (layer as { id?: unknown }).id === "string"
        ? ((layer as { id: string }).id as string)
        : opts.id;
    const idx = travelerIndex(spec, layer);
    const pathId = explicitId ?? `traveler-path-${idx}`;

    // E2 review IMPORTANT — pathId collision. If two traveler layers
    // (or a traveler + another layer) emit the same id, the browser
    // resolves `<mpath href="#..."/>` to the FIRST match, so the
    // second traveler silently rides the wrong path. Validate that
    // explicit ids are unique across the whole spec (auto-generated
    // `traveler-path-N` ids are unique by construction since N is the
    // traveler-layer index in spec order).
    if (explicitId !== undefined) {
      let collisions = 0;
      for (let i = 0; i < spec.layers.length; i++) {
        const other = spec.layers[i];
        if (!other) continue;
        const otherId =
          typeof (other as { id?: unknown }).id === "string"
            ? ((other as { id: string }).id as string)
            : (other as { traveler?: { id?: string } }).traveler?.id;
        if (otherId === explicitId) collisions++;
      }
      if (collisions > 1) {
        throw new Error(
          `traveler: id "${explicitId}" is used by ${collisions} layers in this spec. ` +
            "Layer / traveler ids must be unique because <mpath> resolves to the first " +
            "match in document order.",
        );
      }
    }

    // Hidden anchor path. stroke=none + fill=none keeps the geometry
    // invisible while the id stays referenceable by `<mpath>`. Emitted
    // BEFORE the dot so the `<mpath>` reference resolves at parse
    // time in document order (browsers tolerate forward refs but
    // emitting in order is the conventional pattern).
    out.push({
      type: "path",
      d,
      stroke: "none",
      fill: "none",
      id: pathId,
    });

    const first = polyline[0];
    if (!first) return;

    // Trail circles (if requested). K is computed from N * trail.length
    // where N is the polyline sample count, then capped at 12 so a
    // chart with 1000 samples doesn't emit 200 SMIL elements. The
    // tail starts at the largest negative `begin` offset and the head
    // sits at zero offset so all trail dots loop in sync with the
    // head circle.
    if (opts.trail && opts.trail.length > 0) {
      const N = polyline.length;
      const K = Math.min(12, Math.max(0, Math.round(N * opts.trail.length)));
      if (K > 0) {
        // Each trail circle is offset by (i/K * tail-window) ms behind
        // the head, where tail-window is a fraction of the loop dur
        // matching trail.length. SMIL's `begin` accepts negative
        // offsets to mean "this animation already started N ms ago at
        // t=0" — that's how the tail appears already laid out at the
        // start frame.
        const tailWindowMs = opts.durationMs * opts.trail.length;
        for (let i = 1; i <= K; i++) {
          // i=1 → closest to head, i=K → furthest tail.
          const offsetMs = -Math.round((tailWindowMs * i) / K);
          const opacity = opts.trail.fade
            ? roundOpacity(TRAIL_FADE_MAX - ((TRAIL_FADE_MAX - TRAIL_FADE_MIN) * i) / K)
            : TRAIL_FADE_MAX;
          const trailMark: SceneMark = {
            type: "circle",
            cx: first.x,
            cy: first.y,
            r: opts.radius,
            fill: opts.color,
            opacity,
            motion: {
              pathId,
              durationMs: opts.durationMs,
              beginMs: offsetMs,
            },
          };
          out.push(trailMark);
        }
      }
    }

    // Head circle. Emitted LAST so it paints on top of the trail.
    const head: SceneMark = {
      type: "circle",
      cx: first.x,
      cy: first.y,
      r: opts.radius,
      fill: opts.color,
      motion: {
        pathId,
        durationMs: opts.durationMs,
      },
    };
    out.push(head);
  },
};

/**
 * Round opacity to 3 decimals so the SMIL output stays byte-stable
 * across re-renders. Floating drift on `0.5833333...` would otherwise
 * surface in the snapshot.
 */
function roundOpacity(v: number): number {
  return Math.round(v * 1000) / 1000;
}

registerMark(travelerMarkCompiler);
