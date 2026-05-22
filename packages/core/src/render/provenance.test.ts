/**
 * Tests for the cryptographic provenance seal (Moat PR1).
 *
 * What these guard:
 *   - specHash is canonical: key-order doesn't matter, content does.
 *   - dataHash is null when no rows, deterministic otherwise.
 *   - scaleDigest changes when the resolved scale domain changes.
 *   - The block carries the documented format version.
 *   - Timestamp is opt-in; off by default for byte stability.
 */

import { describe, expect, it } from "vitest";
import type { GlyphSpec } from "../spec/types.js";
import {
  PROVENANCE_FORMAT,
  canonicalStringify,
  computeProvenance,
  diffProvenance,
  extractProvenanceFromSvg,
  renderProvenanceMetadata,
} from "./provenance.js";

const SPEC: GlyphSpec = {
  data: { source: "x.parquet" },
  layers: [{ mark: "bar", encoding: { x: "a", y: "b" } }],
};

// A second-form of the same spec with the SAME meaning but keys in a
// different recursive order. Hashing must produce the same digest.
const SPEC_KEYS_REORDERED: GlyphSpec = {
  layers: [{ encoding: { y: "b", x: "a" }, mark: "bar" }],
  data: { source: "x.parquet" },
};

const SCHEMA = [
  { name: "a", type: "VARCHAR" },
  { name: "b", type: "INTEGER" },
];

const ROWS = [
  ["hi", 1],
  ["bye", 2],
];

describe("canonicalStringify", () => {
  it("sorts object keys recursively", () => {
    const a = canonicalStringify({ b: 1, a: { z: 2, y: 3 } });
    const b = canonicalStringify({ a: { y: 3, z: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it("preserves array order (order is semantically meaningful)", () => {
    expect(canonicalStringify([1, 2, 3])).not.toBe(canonicalStringify([3, 2, 1]));
  });

  it("drops undefined values like JSON.stringify does", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("encodes bigints as a string tag so they round-trip", () => {
    expect(canonicalStringify({ n: 42n })).toBe('{"n":"N:42"}');
  });

  it("treats null and undefined identically at the top level", () => {
    expect(canonicalStringify(null)).toBe("null");
    expect(canonicalStringify(undefined)).toBe("null");
  });
});

describe("computeProvenance — format + version", () => {
  it("emits the documented schema version", () => {
    const block = computeProvenance({
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    expect(block.format).toBe(PROVENANCE_FORMAT);
    expect(block.format).toBe("glyph-provenance/1");
  });
});

describe("computeProvenance — specHash", () => {
  it("is stable across re-orderings of spec keys", () => {
    const a = computeProvenance({
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    const b = computeProvenance({
      spec: SPEC_KEYS_REORDERED,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    expect(b.specHash).toBe(a.specHash);
  });

  it("differs when spec content differs", () => {
    const a = computeProvenance({
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    const b = computeProvenance({
      spec: {
        ...SPEC,
        layers: [{ mark: "point", encoding: { x: "a", y: "b" } }],
      },
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    expect(b.specHash).not.toBe(a.specHash);
  });
});

describe("computeProvenance — dataHash", () => {
  it("is null when rows are empty", () => {
    const block = computeProvenance({
      spec: SPEC,
      rows: [],
      schema: SCHEMA,
      scales: { xDomain: undefined, yDomain: undefined },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    expect(block.dataHash).toBeNull();
    expect(block.rowCount).toBe(0);
  });

  it("is deterministic for the same non-empty rows + schema", () => {
    const args = {
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] as [number, number] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    } as const;
    const a = computeProvenance(args);
    const b = computeProvenance(args);
    expect(a.dataHash).toBe(b.dataHash);
    expect(a.dataHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.rowCount).toBe(2);
  });

  it("changes when a single row value flips", () => {
    const a = computeProvenance({
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    const b = computeProvenance({
      spec: SPEC,
      rows: [
        ["hi", 1],
        ["bye", 99],
      ],
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 99] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    expect(b.dataHash).not.toBe(a.dataHash);
  });
});

describe("computeProvenance — scaleDigest", () => {
  it("changes when the scale domain changes", () => {
    const base = {
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    } as const;
    const a = computeProvenance({
      ...base,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
    });
    const b = computeProvenance({
      ...base,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 10] },
    });
    expect(b.scaleDigest).not.toBe(a.scaleDigest);
  });

  it("matches when both scales are absent (faceted / hierarchy paths)", () => {
    const args = {
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: undefined, yDomain: undefined },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    } as const;
    const a = computeProvenance(args);
    const b = computeProvenance(args);
    expect(a.scaleDigest).toBe(b.scaleDigest);
    expect(a.scaleDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeProvenance — generatedAt (opt-in)", () => {
  it("is omitted by default", () => {
    const block = computeProvenance({
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    expect(block.generatedAt).toBeUndefined();
  });

  it("opting in produces a valid ISO 8601 timestamp", () => {
    const block = computeProvenance({
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: true,
    });
    expect(block.generatedAt).toBeDefined();
    expect(block.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Date.parse handles ISO 8601 deterministically.
    expect(Number.isFinite(Date.parse(block.generatedAt as string))).toBe(true);
  });
});

describe("renderProvenanceMetadata + extractProvenanceFromSvg", () => {
  it("round-trips a block through the SVG <metadata> wrapper", () => {
    const block = computeProvenance({
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    const meta = renderProvenanceMetadata(block);
    // Wrapped in CDATA, has the canonical id.
    expect(meta).toContain('id="glyph-provenance"');
    expect(meta).toContain("<![CDATA[");
    expect(meta).toContain("]]>");

    // Faux SVG body — extractor uses a regex.
    const svg = `<svg>${meta}</svg>`;
    const back = extractProvenanceFromSvg(svg);
    expect(back).not.toBeNull();
    expect(back?.format).toBe(PROVENANCE_FORMAT);
    expect(back?.specHash).toBe(block.specHash);
    expect(back?.dataHash).toBe(block.dataHash);
    expect(back?.scaleDigest).toBe(block.scaleDigest);
  });

  it("returns null for an SVG without a provenance block", () => {
    expect(extractProvenanceFromSvg("<svg></svg>")).toBeNull();
  });
});

describe("diffProvenance", () => {
  it("returns an empty list when seals match", () => {
    const block = computeProvenance({
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    expect(diffProvenance(block, block)).toEqual([]);
  });

  it("flags specHash / dataHash / scaleDigest mismatches", () => {
    const a = computeProvenance({
      spec: SPEC,
      rows: ROWS,
      schema: SCHEMA,
      scales: { xDomain: ["hi", "bye"], yDomain: [0, 2] },
      libraryVersion: "0.0.0",
      includeTimestamp: false,
    });
    const b = {
      ...a,
      specHash: "0".repeat(64),
      dataHash: "1".repeat(64),
    };
    const mismatches = diffProvenance(a, b);
    const fields = mismatches.map((m) => m.field);
    expect(fields).toContain("specHash");
    expect(fields).toContain("dataHash");
    expect(fields).not.toContain("generatedAt");
  });
});
