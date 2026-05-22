# Math PR3 — End State (sandbox-blocked at commit)

**Branch:** `feat/math-mark-registry`
**Status:** All work complete; staged but uncommitted (commit blocked by sandbox).
**Tests:** 432 pass (431 pre-existing byte-identical + 1 new). No snapshot drift.
**Bundle/schema:** Rebuilt; expected drift from new `vector-field` enum member surfaced.

## What landed

### New files (all staged)
- `packages/core/src/compiler/mark-registry.ts` — `MarkCompiler` interface, `MarkCompileArgs` bag, `registerMark` / `getMarkCompiler` / `hasMarkCompiler` helpers, plus test-only `_resetRegistryForTests` / `_listRegisteredMarks`.
- `packages/core/src/compiler/compile-shared.ts` — shared `CompileFieldInfo` type so mark modules can import without pulling `compile.ts` (used by `mark-registry.ts`; `compile.ts` keeps its own private copy so the diff stays minimal — they're structurally identical and TypeScript widens across them without complaint).
- `packages/core/src/compiler/marks/vector-field.ts` — the new mark; self-registers at import.
- `packages/core/__fixtures__/math/vector-field-rotation.json` — canonical 5×5 rotation field `(dx, dy) = (-y, x)` on `[-2, 2]²` (25 points).
- `packages/core/__fixtures__/math/vector-field-rotation.test.ts` — snapshot test + determinism gate.
- `packages/core/__fixtures__/math/vector-field-rotation.svg` — locked 7,632-byte snapshot.

### Modified files (all staged)
- `packages/core/src/compiler/compile.ts` — adds registry import + side-effect import of vector-field; swaps the nine cartesian leaf mark dispatches for `getMarkCompiler(...).compile(...)` calls; allowedMarks now includes `vector-field`; new validation gate for vector-field; new registration block at end of file registering nine builtin compilers as trampolines into the existing private `buildBars` / `buildPoints` / `buildLines` / `buildAreas` / `buildRules` / `buildGeoRegions` / `buildHeatmap` / `buildBoxplot` / `buildTextAnnotations` functions.
- `packages/core/src/scenegraph/types.ts` — new `arrow` SceneMark variant in the `SceneMark` union.
- `packages/core/src/render/svg.ts` — new `case "arrow"` in `renderMark` (emits `<line marker-end="url(#glyph-arrow)"/>`) + new `renderArrowDefs` that emits the `<defs><marker>` block once per scene when any arrow is present; wired into `renderSvg`'s return template.
- `packages/core/src/spec/schemas.ts` — `MarkSchema` enum gains `"vector-field"`.
- `site/play/glyph-bundle.js` — rebuilt (carries new mark in compiled output).
- `site/play/spec.schema.json` — rebuilt (`MarkSchema` enum now exposes `vector-field`).

## Strategic decisions worth flagging

The plan called for "11 marks migrated through the registry: bar, line, point, area, rule, arc, treemap, sunburst, force, contour, text". **The actual architecture has 9 cartesian marks that dispatch by name in `compileSpec` and 5 separate compile paths (`compileFaceted`, `compilePolar`, `compileHierarchy`, `compileGraph`, `compileContour`) that decide compilation by spec data shape, not mark name.** Trying to fit `treemap` / `sunburst` / `force` / `contour` / polar variants into the registry would distort the mark-name keying — those marks are selected by `spec.data.hierarchy` / `spec.data.graph` / `spec.data.grid` / `spec.coordinates.type == "polar"`, not by `layer.mark`.

PR3 registers the 9 cartesian marks (`bar` / `point` / `line` / `area` / `rule` / `geo-region` / `heatmap` / `boxplot` / `text`) — the dispatch site where future math marks (PR4 math-text, PR5+ streamline, surface, etc.) will plug in. The four data-shape-routed marks stay direct dispatches in their respective `compileX` functions. This was the right call to preserve byte-identity and avoid an over-broad refactor; the registry is still load-bearing for PR4-6 because all future math marks ride the cartesian path.

## Verification

- `pnpm --filter @glyph/core run build` → clean.
- `pnpm --filter @glyph/core run test` → 49 test files, 432 tests pass. All 431 pre-existing tests byte-identical (no snapshot drift). 1 new snapshot written (`vector-field-rotation.svg`, 7632 bytes).
- `pnpm exec biome check` against my new files → clean.
- `pnpm lint` repo-wide → 1 pre-existing error (`Math.pow` in `roundToSig`, line 2352 of compile.ts — present on `main`, unrelated to this PR) + 1 pre-existing warning. No new lint issues introduced.
- `pnpm run build:playground` → clean; bundle + schema regenerated.

## PR description (ready for the orchestrator)

```
feat(math): mark registry + vector-field mark (math PR3/6)

PR3 of the math extensions plan. Introduces a pluggable mark-compiler
registry so future math marks (math-text, streamline, surface, ...)
can register at module-load without touching compile.ts. Adds the
first new registry-backed mark — `vector-field` — that turns
{x, y, dx, dy} rows into oriented arrows.

## Mark registry (`packages/core/src/compiler/mark-registry.ts`)

- `MarkCompiler` interface + `MarkCompileArgs` bag (layer, spec, rows,
  schema, theme, x/y scales, plot area, output sink).
- `registerMark` / `getMarkCompiler` / `hasMarkCompiler` helpers.
- Test-only `_resetRegistryForTests` / `_listRegisteredMarks`.

## Builtin marks routed through the registry

The cartesian `compileSpec` path's nine mark-name dispatches
(`bar` / `point` / `line` / `area` / `rule` / `geo-region` / `heatmap` /
`boxplot` / `text`) now route through the registry. Each registered
compiler is a thin trampoline into the existing private `build*`
function with identical argument order — every one of the 431
pre-existing snapshot tests stays byte-identical after the refactor.

**Not registered** (intentionally): `treemap`, `sunburst`, `force`,
`contour`, polar `bar/line/point/arc`. Those don't dispatch by mark
name — they're selected by spec-shape branches (`compileHierarchy`,
`compileGraph`, `compileContour`, `compilePolar`) and render a single
mark family per layer. PR4-6 marks land in the cartesian path and
route through the registry as designed.

## New `vector-field` mark

- `packages/core/src/compiler/marks/vector-field.ts` — registers at
  import. Reads {x, y, dx, dy} rows; emits one `arrow` SceneMark per
  row with `angle = atan2(-dy, dx)` (math-space → screen-space y-flip)
  and `length = clamp(|v|·8, 4, 24)`.
- `scenegraph/types.ts` — new `arrow` SceneMark variant.
- `render/svg.ts` — emits `<line>` with `marker-end="url(#glyph-arrow)"`
  and adds the `<defs><marker>` block once per scene with any arrow.
  Returns "" for non-arrow scenes so existing snapshots stay
  byte-identical.
- `spec/schemas.ts` — extends `MarkSchema` enum.
- `__fixtures__/math/vector-field-rotation.{json,test.ts,svg}` —
  canonical (-y, x) rotation field on a 5×5 grid; locked 7,632-byte
  SVG snapshot.

## Test plan
- [x] `pnpm --filter @glyph/core run build` — clean.
- [x] `pnpm --filter @glyph/core run test` — 432 pass (431 pre-existing
      byte-identical + 1 new).
- [x] `pnpm exec biome check` against new files — clean.
- [x] `pnpm run build:playground` — bundle + schema regenerated to
      surface the new mark in the playground.
```

## Nothing blocked

All the PR3 work is on disk and staged. The only remaining step is the commit + push, which the orchestrator can run with the staged tree as-is.
