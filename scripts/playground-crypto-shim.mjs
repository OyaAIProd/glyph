/**
 * Browser SHA-256 shim for the playground bundle.
 *
 * @glyph/core's render/provenance.ts imports `createHash` from
 * `node:crypto` to compute the spec/data seal hash. That import is fine
 * for Node consumers (CLI, MCP server, server-side renders) but esbuild
 * can't resolve `node:crypto` when bundling for `platform: "browser"`.
 *
 * This shim exposes a synchronous `createHash("sha256")` API compatible
 * with the call site `createHash("sha256").update(s).digest("hex")` so
 * the playground bundle builds and the rendered SVG carries the same
 * provenance seal shape it does server-side. The implementation is a
 * straightforward textbook SHA-256 — no dependencies, no
 * `crypto.subtle` (which is async and would require refactoring the
 * render pipeline to be async), no WASM.
 *
 * Output is byte-identical to `node:crypto` for the same input — both
 * implement FIPS 180-4 — so the playground's seal is a real cryptographic
 * hash, not a placeholder.
 *
 * @glyph/mcp + the CLI continue to use Node's native `createHash`. Only
 * the playground browser bundle goes through this shim.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n, x) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function utf8Bytes(s) {
  // Spec strings + canonicalized JSON are ASCII-dominated but allow
  // multibyte (Unicode column names, etc). Use the platform encoder.
  return new TextEncoder().encode(s);
}

/** Returns the SHA-256 digest of the byte sequence as a 64-char hex string. */
function sha256Hex(bytes) {
  // Pre-processing — pad to 512-bit blocks, append 64-bit length.
  const len = bytes.length;
  const bitLen = len * 8;
  const padLen = (len + 9 + 63) & ~63;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[len] = 0x80;
  // 64-bit big-endian length at the end. We only support lengths < 2^32
  // bytes (~4 GB) — the playground's canonical-stringified specs are tiny.
  buf[padLen - 4] = (bitLen >>> 24) & 0xff;
  buf[padLen - 3] = (bitLen >>> 16) & 0xff;
  buf[padLen - 2] = (bitLen >>> 8) & 0xff;
  buf[padLen - 1] = bitLen & 0xff;

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);

  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      const p = off + i * 4;
      W[i] = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, W[i - 15]) ^ rotr(18, W[i - 15]) ^ (W[i - 15] >>> 3);
      const s1 = rotr(17, W[i - 2]) ^ rotr(19, W[i - 2]) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  let hex = "";
  for (let i = 0; i < 8; i++) {
    hex += H[i].toString(16).padStart(8, "0");
  }
  return hex;
}

/**
 * `createHash("sha256")` API surface compatible with Node's
 * `crypto.createHash`. Only SHA-256 + hex output are wired — the only
 * combination provenance.ts actually uses. Anything else throws so
 * future callers don't silently get the wrong algorithm.
 */
export function createHash(algorithm) {
  if (algorithm !== "sha256") {
    throw new Error(
      `playground crypto shim: unsupported algorithm "${algorithm}" (only sha256 is wired)`,
    );
  }
  const chunks = [];
  return {
    update(input) {
      if (typeof input === "string") {
        chunks.push(utf8Bytes(input));
      } else if (input instanceof Uint8Array) {
        chunks.push(input);
      } else {
        throw new Error("playground crypto shim: update() expects a string or Uint8Array");
      }
      return this;
    },
    digest(encoding) {
      if (encoding !== "hex") {
        throw new Error(
          `playground crypto shim: unsupported digest encoding "${encoding}" (only "hex" is wired)`,
        );
      }
      let total = 0;
      for (const c of chunks) total += c.length;
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.length;
      }
      return sha256Hex(buf);
    },
  };
}
