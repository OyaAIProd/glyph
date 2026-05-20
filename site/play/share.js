// site/play/share.js
// Share helpers for the Glyph playground. Two paths:
//
//   1. URL-hash mode — compress `{spec, csv}` with pako and base64url it into
//      `#h=<…>`. No network, no auth, no rate limits. Capped by URL length
//      (~7.5 KB safe budget, see encoded-URL guard in playground.js).
//
//   2. Anonymous Gist mode — POST to https://api.github.com/gists with no
//      auth. GitHub allows it but rate-limits ~60/hour per IP. On 403 we
//      surface a typed error so the caller can fall back to the
//      "Save to my account" clipboard + new-tab path.
//
// The shared payload shape is `{ spec, csv }` everywhere — URL hash, Gist
// JSON, and clipboard block — so a roundtrip is identity.
import * as pako from "https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm";

// ---------- URL hash mode ----------

/**
 * Compress + base64url-encode a `{spec, csv}` payload for a URL fragment.
 * @param {{spec: object, csv: string | null}} payload
 * @returns {string} base64url string suitable for `#h=…`
 */
export function encodeShareUrl(payload) {
  const json = JSON.stringify(payload);
  const compressed = pako.deflate(new TextEncoder().encode(json));
  return base64UrlEncode(compressed);
}

/**
 * Inverse of {@link encodeShareUrl}. Throws on malformed input.
 * @param {string} hash base64url string (without the `#h=` prefix)
 * @returns {{spec: object, csv: string | null}}
 */
export function decodeShareUrl(hash) {
  const bytes = base64UrlDecode(hash);
  const json = pako.inflate(bytes, { to: "string" });
  return JSON.parse(json);
}

// Back-compat aliases — the plan referred to encodeHash/decodeHash; keep
// them so callers can use whichever name reads better in context.
export const encodeHash = encodeShareUrl;
export const decodeHash = decodeShareUrl;

// ---------- Anonymous Gist mode ----------

/**
 * Typed error surfaced when the anonymous-gist endpoint rate-limits us.
 * Callers can check `e instanceof GistRateLimitError` to decide whether
 * to drop into the "Save to my account" fallback flow.
 */
export class GistRateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "GistRateLimitError";
  }
}

/**
 * Create an anonymous public Gist with the playground spec + optional CSV.
 *
 * Files written:
 *   - `playground.glyph.json`  — pretty-printed spec
 *   - `data.csv`               — only if `csv` is non-empty
 *
 * @param {{spec: object, csv?: string | null, description?: string}} input
 * @returns {Promise<{id: string, html_url: string}>}
 * @throws {GistRateLimitError} on 403 (rate-limited)
 * @throws {Error} on any other non-2xx response
 */
export async function createAnonymousGist({ spec, csv, description }) {
  const files = {
    "playground.glyph.json": { content: JSON.stringify(spec, null, 2) },
  };
  if (csv) files["data.csv"] = { content: csv };
  const res = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      description: description || "Glyph playground",
      public: true,
      files,
    }),
  });
  if (!res.ok) {
    if (res.status === 403) {
      throw new GistRateLimitError(
        "GitHub rate limit reached for anonymous gists. Try 'Save to my account' instead.",
      );
    }
    throw new Error(`Gist API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return { id: data.id, html_url: data.html_url };
}

/**
 * Fetch a Gist and parse its `playground.glyph.json` + optional `data.csv`.
 * @param {string} id Gist ID
 * @returns {Promise<{spec: object | null, csv: string | null}>}
 */
export async function fetchGist(id) {
  const res = await fetch(`https://api.github.com/gists/${id}`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`Gist not found: ${id} (${res.status})`);
  const data = await res.json();
  const specFile = data.files?.["playground.glyph.json"];
  const csvFile = data.files?.["data.csv"];
  return {
    spec: specFile ? JSON.parse(specFile.content) : null,
    csv: csvFile ? csvFile.content : null,
  };
}

// ---------- "Save to my account" — opens GitHub UI ----------

/**
 * Fallback when the anonymous gist API is rate-limited. We copy the
 * spec + CSV onto the clipboard and open GitHub's gist creator in a new
 * tab; the user signs in with their own account, pastes the content,
 * and clicks "Create" — their gist, their account, no rate limits for us.
 *
 * GitHub's create-gist UI doesn't officially accept prefill content via
 * query params, so the clipboard hop is the cleanest path that doesn't
 * involve an OAuth dance.
 *
 * @param {{spec: object, csv?: string | null}} input
 */
export async function openSaveToMyAccount({ spec, csv }) {
  const block = [
    "# playground.glyph.json",
    JSON.stringify(spec, null, 2),
    "",
    "# data.csv",
    csv ?? "",
  ].join("\n");
  try {
    await navigator.clipboard.writeText(block);
  } catch (_e) {
    // Some browsers block clipboard.writeText() in non-user-gesture
    // contexts. The new-tab open below still helps; just warn.
    console.warn("Could not copy to clipboard automatically — paste manually.");
  }
  window.open("https://gist.github.com/", "_blank", "noopener,noreferrer");
}

// ---------- helpers ----------

function base64UrlEncode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(s) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
