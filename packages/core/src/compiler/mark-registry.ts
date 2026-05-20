/**
 * Math PR3 — Mark compiler registry.
 *
 * Today's compiler dispatches mark types via inline `if (layer.mark === "X")`
 * chains spread across `compile.ts`. The registry promotes that dispatch
 * into a pluggable lookup so future marks (`vector-field`, `math-text`,
 * `streamline`, ...) can register themselves at module-load without
 * touching `compile.ts`.
 *
 * Scope (PR3):
 *   - The registry owns the LEAF "given resolved scales + rows + encoding,
 *     push SceneMarks into the output array" step.
 *   - Spec-shape decisions (faceted? polar? hierarchy? graph? contour?)
 *     stay in `compile.ts` because they decide which compile path to enter
 *     before any marks are touched. Per-layer validation (e.g. boxplot
 *     needs band x) also stays inline — it's a shape gate, not mark work.
 *
 * Determinism:
 *   - Registration order does not affect output. The compiler iterates
 *     `spec.layers` in spec order and looks up each layer's mark by name.
 *   - Trampoline-style registration (this PR) keeps every existing build*
 *     function's body unchanged, so all 431 pre-existing snapshot tests
 *     stay byte-identical.
 */
import type { SceneMark } from "../scenegraph/types.js";
import type { Encoding, GlyphSpec, InteractiveConfig } from "../spec/types.js";
import type { CompileFieldInfo } from "./compile-shared.js";
import type { bandScale, linearScale } from "./scales.js";

/**
 * Internal Theme shape used by mark compilers. Mirrors the private Theme
 * in `compile.ts`; surfaced here so mark modules outside that file can
 * still receive it. Kept structurally identical so trampoline-style
 * registration is a no-op refactor.
 */
export interface MarkTheme {
  readonly background: string;
  readonly fg: string;
  readonly axis: string;
  readonly grid: string;
  readonly marks: ReadonlyArray<string>;
}

/** Compiler context passed to mark builders for interactive metadata. */
export interface MarkCtx {
  readonly interactive: InteractiveConfig | undefined;
  readonly xField: string;
  readonly yField: string;
  readonly colorField: string | undefined;
  readonly tooltip: Encoding["tooltip"];
}

/** Generic x scale — band OR linear. */
export type XScaleAny = ReturnType<typeof bandScale> | ReturnType<typeof linearScale>;
/** y scale — always linear for cartesian marks. */
export type YScaleLinear = ReturnType<typeof linearScale>;

/**
 * Bag of context handed to every mark compiler. Some fields are mark-type
 * specific (boxplot needs a band x scale; vector-field needs neither
 * scale to be band-shaped) — compilers may narrow or ignore fields as
 * needed. This generic shape stays stable across PR3-PR6 so adding a new
 * mark is purely additive.
 */
export interface MarkCompileArgs {
  /** The layer the mark belongs to (mark string + encoding live here). */
  readonly layer: GlyphSpec["layers"][number];
  /** Whole spec (for cross-layer queries: title, theme, interactive, ...). */
  readonly spec: GlyphSpec;
  /** Materialized rows, positional by schema field index. */
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Column metadata (name + type). Indexes line up with each row tuple. */
  readonly schema: ReadonlyArray<CompileFieldInfo>;
  /** Resolved theme tokens (palette, background, axis color, ...). */
  readonly theme: MarkTheme;
  /** Resolved x scale (band or linear). */
  readonly xScale: XScaleAny;
  /** Resolved y scale (left-side; right-side handled separately). */
  readonly yScale: YScaleLinear | undefined;
  /** x field name, when the layer has an x encoding; "" for rule-without-x. */
  readonly xField: string;
  /** y field name; "" for rule-without-y. */
  readonly yField: string;
  /** Interactive / tooltip context — undefined for marks that don't accept it. */
  readonly ctx: MarkCtx | undefined;
  /** Plot area rectangle. */
  readonly plotArea: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** Sink — compilers push their SceneMarks here. */
  readonly out: SceneMark[];
}

/**
 * A mark compiler converts one layer's worth of resolved encoding +
 * data into SceneMarks. PR3 trampolines existing builders (buildBars,
 * buildPoints, ...) through this interface; PR4+ marks (math-text,
 * vector-field) implement it directly.
 */
export interface MarkCompiler {
  /** Mark type as it appears in `spec.layers[i].mark` (e.g. "bar"). */
  readonly type: string;
  /** Append SceneMarks to `args.out`. Must be pure (no side effects beyond `out`). */
  compile(args: MarkCompileArgs): void;
}

const registry = new Map<string, MarkCompiler>();

/**
 * Register a mark compiler. Throws if the type is already registered —
 * collisions are programmer errors (each mark module owns one name).
 */
export function registerMark(c: MarkCompiler): void {
  if (registry.has(c.type)) {
    throw new Error(`Mark "${c.type}" already registered`);
  }
  registry.set(c.type, c);
}

/**
 * Look up a mark compiler by type. Throws on unknown — callers should
 * gate on `hasMarkCompiler` first when the mark name is user-controlled.
 */
export function getMarkCompiler(type: string): MarkCompiler {
  const c = registry.get(type);
  if (!c) throw new Error(`Unknown mark type: ${type}`);
  return c;
}

/** Cheap check for registry membership. */
export function hasMarkCompiler(type: string): boolean {
  return registry.has(type);
}

/**
 * Test-only: clear the registry. Mark modules re-register at import,
 * so tests should re-import them after calling this. Most production
 * code never needs this.
 */
export function _resetRegistryForTests(): void {
  registry.clear();
}

/** Test-only: list registered mark types in registration order. */
export function _listRegisteredMarks(): string[] {
  return Array.from(registry.keys());
}
