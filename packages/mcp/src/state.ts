/**
 * Process-lifetime state for the MCP server.
 *
 * One engine, a handle store keyed by handle id, and a serial mutex so async
 * tool calls don't race on the DuckDB connection. (DuckDB's connection model
 * is single-writer; serializing here is simpler than pooling for Phase 0.)
 *
 * Also owns the optional preview server (lazy-started on first
 * `glyph_preview` call; stopped on close).
 */

import { randomUUID } from "node:crypto";
import type {
  ComputeEngine,
  DataHandle,
  MetricDefinition,
  QueryHandle,
  SpecAction,
} from "@glyph/core";
import { createDuckDBEngine, materializeRowsAsHandle, materializeSpec } from "@glyph/duckdb";
import {
  type PreviewServer,
  type PreviewServerOptions,
  createPreviewServer,
} from "@glyph/preview-server";
import { LinkGroupStore } from "./linked.js";
import { MemoryStore, defaultMemoryPath } from "./memory.js";
import { StoryStore } from "./story.js";

export class ServerState {
  private engine: ComputeEngine | undefined;
  private readonly handles = new Map<string, DataHandle>();
  /** Secondary index: gdf:// uri → handle id. Populated when handles are stored. */
  private readonly handlesByUri = new Map<string, string>();
  /** PR60 item 1.6 — last-access timestamps (ms) for TTL-based auto-GC. */
  private readonly handleLastAccess = new Map<string, number>();
  /** PR60 item 1.6 — handles that explicitly opted out of GC (via memory.save or pinHandle). */
  private readonly pinnedHandles = new Set<string>();
  /** PR60 item 1.6 — TTL in ms; default 30 min. Configurable via constructor option. */
  private readonly handleTtlMs: number;
  /** Per-session id for minted URIs. Random per ServerState instance. */
  readonly sessionId: string;
  private readonly svgsByHandle = new Map<string, string>();
  /**
   * PR62 (PLAN item 1.8) — remembers the spec that produced each handle.
   * Used by `glyph_spec_patch` to re-run the pipeline with RFC 6902 edits
   * applied. Stored as the *original* spec (pre-materializer rewrites) so
   * patches operate on the same JSON the caller originally sent.
   */
  private readonly specByHandle = new Map<string, unknown>();
  /** Phase 3 §1: session-scoped registry of named metrics. */
  private readonly metrics = new Map<string, MetricDefinition>();
  /** Phase 3 §4: actions declared in the spec that produced each handle. */
  private readonly actionsByHandle = new Map<string, ReadonlyArray<SpecAction>>();
  private chain: Promise<unknown> = Promise.resolve();
  private preview: PreviewServer | undefined;
  private readonly previewOptions: PreviewServerOptions;
  /** Phase 3 §6: lazy-initialized persistent memory store. */
  readonly memory: MemoryStore;
  /** PR41 Story Agent: in-process registry of plans + checkpoint queues. */
  readonly stories = new StoryStore();
  /** PR46 linked-view filter bus. */
  readonly links = new LinkGroupStore();

  constructor(
    options: {
      preview?: PreviewServerOptions;
      sessionId?: string;
      /** Override the persistent-memory file path. Tests pass a temp file. */
      memoryPath?: string;
      /** PR60 item 1.6 — TTL for auto-GC of unused derived handles (ms). Default 1800_000 (30 min). */
      handleTtlMs?: number;
    } = {},
  ) {
    this.previewOptions = options.preview ?? {};
    this.sessionId = options.sessionId ?? randomUUID().replace(/-/g, "").slice(0, 16);
    this.memory = new MemoryStore(options.memoryPath ?? defaultMemoryPath());
    this.handleTtlMs = options.handleTtlMs ?? 30 * 60 * 1000;
  }

  async getEngine(): Promise<ComputeEngine> {
    if (!this.engine) {
      this.engine = await createDuckDBEngine();
    }
    return this.engine;
  }

  /** Store a handle and (if it carries a URI) index it by URI as well. */
  storeHandle(handle: QueryHandle): void {
    this.handles.set(handle.id, handle as DataHandle);
    const h = handle as DataHandle;
    if (h.uri) {
      this.handlesByUri.set(h.uri, h.id);
    }
    this.handleLastAccess.set(handle.id, Date.now());
  }

  getHandle(id: string): DataHandle | undefined {
    const h = this.handles.get(id);
    if (h) this.handleLastAccess.set(id, Date.now());
    return h;
  }

  /** PR60 item 1.6 — pin a handle so the TTL reaper won't evict it. */
  pinHandle(id: string): void {
    this.pinnedHandles.add(id);
  }

  /**
   * PR60 item 1.6 — drop handles untouched for `handleTtlMs`. Pinned
   * handles and ones with descendant handles in the session are spared.
   * Returns the ids that were evicted.
   */
  reapStaleHandles(now: number = Date.now()): ReadonlyArray<string> {
    const cutoff = now - this.handleTtlMs;
    // Build the "has descendant" set in one pass.
    const hasChild = new Set<string>();
    for (const h of this.handles.values()) {
      for (const p of h.lineage?.parents ?? []) {
        const parentId = this.handlesByUri.get(p.uri);
        if (parentId) hasChild.add(parentId);
      }
    }
    const evicted: string[] = [];
    for (const [id, last] of this.handleLastAccess) {
      if (last >= cutoff) continue;
      if (this.pinnedHandles.has(id)) continue;
      if (hasChild.has(id)) continue;
      const h = this.handles.get(id);
      if (!h) continue;
      this.handles.delete(id);
      if (h.uri) this.handlesByUri.delete(h.uri);
      this.handleLastAccess.delete(id);
      this.actionsByHandle.delete(id);
      this.svgsByHandle.delete(id);
      this.specByHandle.delete(id);
      evicted.push(id);
    }
    return evicted;
  }

  /** Lookup a handle by its gdf:// URI. */
  getHandleByUri(uri: string): DataHandle | undefined {
    const id = this.handlesByUri.get(uri);
    return id ? this.handles.get(id) : undefined;
  }

  /** All handles in this session (insertion order). */
  allHandles(): ReadonlyArray<DataHandle> {
    return Array.from(this.handles.values());
  }

  // ---- Metric registry (Phase 3 §1) ----------------------------------------

  /** Register (or replace) a metric. Returns true if it was new. */
  registerMetric(metric: MetricDefinition): boolean {
    const isNew = !this.metrics.has(metric.name);
    this.metrics.set(metric.name, metric);
    return isNew;
  }

  /** Lookup a metric by name. */
  getMetric(name: string): MetricDefinition | undefined {
    return this.metrics.get(name);
  }

  /** All metrics, optionally filtered by name prefix (insertion order). */
  allMetrics(prefix?: string): ReadonlyArray<MetricDefinition> {
    const all = Array.from(this.metrics.values());
    return prefix === undefined ? all : all.filter((m) => m.name.startsWith(prefix));
  }

  // ---- Action registry (Phase 3 §4) ----------------------------------------

  /** Record the actions declared in the spec that produced a handle. */
  setActionsForHandle(handleId: string, actions: ReadonlyArray<SpecAction>): void {
    if (actions.length > 0) this.actionsByHandle.set(handleId, actions);
  }

  /** Look up an action by name on a given handle. */
  getAction(handleId: string, name: string): SpecAction | undefined {
    return this.actionsByHandle.get(handleId)?.find((a) => a.name === name);
  }

  /** All actions registered for a handle (empty if none). */
  actionsFor(handleId: string): ReadonlyArray<SpecAction> {
    return this.actionsByHandle.get(handleId) ?? [];
  }

  /** PR62 (PLAN item 1.8) — remember the originating spec for a handle. */
  storeSpec(handleId: string, spec: unknown): void {
    this.specByHandle.set(handleId, spec);
  }

  /** PR62 (PLAN item 1.8) — fetch the originating spec for a handle. */
  getSpec(handleId: string): unknown | undefined {
    return this.specByHandle.get(handleId);
  }

  /** Cache the rendered SVG for a handle so the preview server can serve it. */
  storeSvg(handleId: string, svg: string): void {
    this.svgsByHandle.set(handleId, svg);
    // If the preview server is already up, register the chart eagerly so a
    // subsequent `glyph_preview` deep-link doesn't 404.
    if (this.preview?.isRunning()) {
      this.preview.registerChart(handleId, svg);
    }
  }

  /** Lazy-start the preview server; idempotent. */
  async getPreview(): Promise<PreviewServer> {
    if (this.preview?.isRunning()) return this.preview;
    if (!this.preview) {
      this.preview = createPreviewServer(this.previewOptions);
    }
    await this.preview.start();
    // Backfill any SVGs we've cached before the server existed.
    for (const [handleId, svg] of this.svgsByHandle) {
      this.preview.registerChart(handleId, svg);
    }
    return this.preview;
  }

  /** Returns the preview server if running, otherwise undefined. */
  getPreviewIfRunning(): PreviewServer | undefined {
    return this.preview?.isRunning() ? this.preview : undefined;
  }

  /** Serialize all engine-touching async work. */
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async close(): Promise<void> {
    await this.chain.catch(() => undefined);
    if (this.preview) {
      await this.preview.stop();
      this.preview = undefined;
    }
    if (this.engine) {
      await this.engine.close();
      this.engine = undefined;
    }
  }
}

export { materializeSpec, materializeRowsAsHandle };
