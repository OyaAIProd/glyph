/**
 * Progressive streaming for long-running MCP verbs — INNOVATION 1.2 (PR72).
 *
 * Uses the MCP SDK's built-in `notifications/progress` channel. When a
 * client sends a request with `_meta.progressToken: "abc"`, the server
 * can call `extra.sendNotification({ method: "notifications/progress",
 * params: { progressToken: "abc", progress, total?, message? } })` from
 * a tool handler. The client subscribes via standard MCP plumbing.
 *
 * **Backward-compatible:** when the client doesn't supply a progress
 * token, the helpers below are no-ops. Existing call sites continue to
 * return the same final result on the same single response.
 *
 * **Why this approach:** the MCP SDK already provides server-side
 * progress notifications via the JSON-RPC `notifications/progress`
 * method. We don't need a new transport layer; we just route our
 * internal milestone events through the SDK's notification channel.
 */

import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

/**
 * The handler-context type passed by McpServer's registerTool callbacks
 * (alias for readability).
 */
export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Extract the client-supplied progress token from a tool handler's
 * `extra` context. Returns undefined when the client didn't request
 * streaming — every streaming call site checks this and short-circuits.
 */
export function progressTokenFor(extra: ToolExtra): string | number | undefined {
  const token = extra?._meta?.progressToken;
  if (typeof token === "string" || typeof token === "number") return token;
  return undefined;
}

/**
 * Send one progress milestone. No-op when the client didn't request
 * streaming. Errors from the SDK are swallowed defensively — a failed
 * notification should NEVER fail the underlying verb call.
 */
export async function sendProgress(
  extra: ToolExtra,
  args: {
    /** Monotonically increasing within a single request. */
    readonly progress: number;
    /** Optional total (units of progress); shown as a percent in some UIs. */
    readonly total?: number;
    /** Short human-readable milestone label. */
    readonly message?: string;
  },
): Promise<void> {
  const token = progressTokenFor(extra);
  if (token === undefined) return;
  try {
    await extra.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken: token,
        progress: args.progress,
        ...(args.total !== undefined ? { total: args.total } : {}),
        ...(args.message !== undefined ? { message: args.message } : {}),
      },
    });
  } catch {
    // Swallow: a transport error on a *progress* notification should not
    // bubble up and fail the user's actual request. The final result
    // still returns normally.
  }
}

/**
 * Convenience wrapper that streams a fixed sequence of milestones.
 * Each milestone is `[progress, message]`; total is `progress[length-1]`.
 *
 * Used by glyph_render's renderer to emit:
 *   1 "parsed spec"
 *   2 "materialized rows"
 *   3 "compiled scene"
 *   4 "rendered svg"
 */
export async function streamMilestones(
  extra: ToolExtra,
  milestones: ReadonlyArray<readonly [number, string]>,
  total: number,
): Promise<void> {
  const token = progressTokenFor(extra);
  if (token === undefined) return;
  for (const [p, msg] of milestones) {
    await sendProgress(extra, { progress: p, total, message: msg });
  }
}
