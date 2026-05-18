/**
 * Tests for ServerState's TTL reaper + handle bookkeeping (PR60 / PLAN 1.6).
 *
 * Critical-gap coverage flagged by the PR-review test analyzer:
 *   - TTL elapses → stale unpinned handle is evicted
 *   - Pinned handle survives even past TTL
 *   - Handle with a descendant in lineage survives (parent of an active child)
 *   - Force=true skips the TTL but still respects pins
 *   - Synthesized inline-data handles are deterministic across calls
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DataHandle } from "@glyph/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServerState, synthesizeInlineDataHandle } from "./state.js";

describe("ServerState — TTL reaper (PR60 / PLAN 1.6)", () => {
  let memDir: string;
  let state: ServerState;

  beforeEach(() => {
    memDir = mkdtempSync(join(tmpdir(), "glyph-state-test-"));
    state = new ServerState({
      memoryPath: join(memDir, "memory.duckdb"),
      handleTtlMs: 60_000, // 1 minute for test convenience
    });
  });

  afterEach(async () => {
    await state.close();
    rmSync(memDir, { recursive: true, force: true });
  });

  function makeHandle(id: string, uri?: string, parents: string[] = []): DataHandle {
    return {
      id,
      viewName: `view_${id}`,
      schema: [],
      uri: uri ?? `gdf://test/${id}`,
      version: 1,
      lineage: {
        parents: parents.map((p) => ({ uri: p, relation: "transform" })),
        sql: "(test)",
        producer: {
          agent: "test",
          tool: "test",
          sessionId: state.sessionId,
          at: "1970-01-01T00:00:00.000Z",
        },
      },
    };
  }

  it("evicts an unpinned handle past its TTL", () => {
    const h = makeHandle("a");
    state.storeHandle(h);
    // Simulate clock advancing > TTL by passing a future `now`.
    const future = Date.now() + 120_000; // +2 min
    const evicted = state.reapStaleHandles(future);
    expect(evicted).toContain("a");
    expect(state.getHandle("a")).toBeUndefined();
  });

  it("a pinned handle survives past its TTL", () => {
    state.storeHandle(makeHandle("p"));
    state.pinHandle("p");
    const future = Date.now() + 120_000;
    const evicted = state.reapStaleHandles(future);
    expect(evicted).not.toContain("p");
    expect(state.getHandle("p")).toBeDefined();
  });

  it("a handle with an active descendant survives even when stale", () => {
    const parent = makeHandle("parent", "gdf://test/parent");
    const child = makeHandle("child", "gdf://test/child", ["gdf://test/parent"]);
    state.storeHandle(parent);
    state.storeHandle(child);
    const future = Date.now() + 120_000;
    const evicted = state.reapStaleHandles(future);
    expect(evicted).not.toContain("parent");
    expect(state.getHandle("parent")).toBeDefined();
  });

  it("a fresh handle (just stored) is NOT evicted at current time", () => {
    state.storeHandle(makeHandle("fresh"));
    const evicted = state.reapStaleHandles();
    expect(evicted).not.toContain("fresh");
  });

  it("evicts multiple stale handles at once", () => {
    state.storeHandle(makeHandle("a"));
    state.storeHandle(makeHandle("b"));
    state.storeHandle(makeHandle("c"));
    const future = Date.now() + 120_000;
    const evicted = state.reapStaleHandles(future);
    expect(evicted.length).toBe(3);
    for (const id of ["a", "b", "c"]) {
      expect(state.getHandle(id)).toBeUndefined();
    }
  });

  it("force-style reap (very-future now) still spares pinned handles", () => {
    state.storeHandle(makeHandle("p"));
    state.pinHandle("p");
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
    const evicted = state.reapStaleHandles(farFuture);
    expect(evicted).not.toContain("p");
    expect(state.getHandle("p")).toBeDefined();
  });
});

describe("synthesizeInlineDataHandle (PR67 / PR68 / B1 fix)", () => {
  it("produces deterministic handle ids given a fixed counter", () => {
    const a = synthesizeInlineDataHandle("session1", 1, {
      data: { hierarchy: { name: "x" } },
      layers: [{ mark: "treemap", encoding: {} }],
    });
    const b = synthesizeInlineDataHandle("session1", 1, {
      data: { hierarchy: { name: "x" } },
      layers: [{ mark: "treemap", encoding: {} }],
    });
    expect(a.handle.id).toBe(b.handle.id);
    expect(a.handle.uri).toBe(b.handle.uri);
  });

  it("uses a sentinel timestamp (never new Date()) so re-renders are byte-stable", () => {
    const h = synthesizeInlineDataHandle("session1", 7, {
      data: { hierarchy: { name: "x" } },
      layers: [{ mark: "treemap", encoding: {} }],
    });
    expect(h.handle.lineage?.producer.at).toBe("1970-01-01T00:00:00.000Z");
  });

  it("omits provenance so the uncertainty pass stays silent", () => {
    const h = synthesizeInlineDataHandle("session1", 1, {
      data: { hierarchy: { name: "x" } },
      layers: [{ mark: "treemap", encoding: {} }],
    });
    expect(h.handle.provenance).toBeUndefined();
  });
});
