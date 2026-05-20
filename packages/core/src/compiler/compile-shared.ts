/**
 * Math PR3 — shared types extracted from `compile.ts` so external modules
 * (mark registry, mark compilers) can import them without pulling in the
 * full compiler graph.
 */

/** Minimal field metadata needed by the compiler. ColumnInfo is a superset. */
export interface CompileFieldInfo {
  readonly name: string;
  readonly type: string;
}
