"""MCP stdio JSON-RPC client. Internal.

Single-caller-at-a-time by construction: each `call_tool` / `list_tools`
acquires an internal lock so a future caller that issues two concurrent
requests cannot race on `_recv` and drop a peer's response. Concurrent
dispatch + notifications/progress fan-out lands in a later PR.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from glyph.exceptions import GlyphError, McpProtocolError

PROTOCOL_VERSION = "2024-11-05"


class McpClient:
    """Async JSON-RPC client over stdio. Spawn one, initialize, call tools."""

    def __init__(self, proc: asyncio.subprocess.Process) -> None:
        self._proc = proc
        self._next_id = 0
        self._initialized = False
        # Serializes _request — protects _recv from being interleaved between
        # two concurrent callers. The simple correlation-id loop in _request
        # would otherwise discard responses targeted at the other caller.
        self._request_lock = asyncio.Lock()
        # Background task that drains stderr into a bounded buffer. Prevents
        # the OS pipe filling up (~64 KB on Linux/macOS) and deadlocking a
        # long-running tool call.
        self._stderr_buf: list[bytes] = []
        self._stderr_task: asyncio.Task[None] | None = None

    @classmethod
    @asynccontextmanager
    async def spawn(cls, args: list[str] | None = None) -> AsyncIterator[McpClient]:
        """Spawn the MCP server, yield a client, terminate on exit.

        When ``args`` is ``None`` (the default), resolution is delegated to
        :func:`glyph._node.resolve_mcp_args` which honours ``$GLYPH_MCP_BIN``,
        a monorepo build, or falls back to ``npx -y @glyph/mcp``. Passing an
        explicit ``args`` list bypasses resolution entirely — used by tests
        that want to pin a specific bundle.
        """
        if args is None:
            # Lazy import: keeps the module-import cost flat and avoids a
            # cycle if _node ever needs to reference the client.
            from glyph._node import resolve_mcp_args

            args = resolve_mcp_args()
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        client = cls(proc)
        client._stderr_task = asyncio.create_task(client._drain_stderr())
        try:
            yield client
        finally:
            if proc.returncode is None:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    # Race-safe: kill may find the process already gone if it
                    # exited between the wait_for timeout and the kill call.
                    with contextlib.suppress(ProcessLookupError):
                        proc.kill()
                    await proc.wait()
                except ProcessLookupError:
                    # Already exited between the returncode check and terminate().
                    pass
            if client._stderr_task is not None:
                client._stderr_task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await client._stderr_task

    async def _drain_stderr(self) -> None:
        """Continuously read stderr into an in-memory buffer.

        Keeps the OS pipe drained so the subprocess never blocks on a full
        stderr buffer. The buffer is bounded at 256 KB; older bytes are
        evicted FIFO once the cap is hit.
        """
        if self._proc.stderr is None:
            return
        CAP = 256 * 1024
        total = 0
        try:
            while True:
                chunk = await self._proc.stderr.read(4096)
                if not chunk:
                    return
                self._stderr_buf.append(chunk)
                total += len(chunk)
                while total > CAP and self._stderr_buf:
                    evicted = self._stderr_buf.pop(0)
                    total -= len(evicted)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Don't let a stderr-read failure poison the client.
            return

    def _stderr_text(self) -> str:
        return b"".join(self._stderr_buf).decode("utf-8", errors="replace")

    async def initialize(self) -> dict[str, Any]:
        """Perform the MCP `initialize` handshake and send `initialized`."""
        result = await self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "clientInfo": {"name": "glyph-py", "version": "0.1.0"},
                "capabilities": {},
            },
        )
        # Send the required initialized notification.
        await self._send_notification("notifications/initialized", {})
        self._initialized = True
        if not isinstance(result, dict):
            raise McpProtocolError(
                f"initialize: expected object result, got {type(result).__name__}"
            )
        return result

    async def list_tools(self) -> list[dict[str, Any]]:
        """Return the list of tool descriptors exposed by the server."""
        if not self._initialized:
            raise GlyphError("call initialize() before list_tools()")
        result = await self._request("tools/list", {})
        tools = result.get("tools") if isinstance(result, dict) else None
        if not isinstance(tools, list):
            raise McpProtocolError(
                f"tools/list: expected 'tools' array, got {type(tools).__name__}"
            )
        return tools

    async def call_tool(self, name: str, args: dict[str, Any]) -> Any:
        """Invoke a tool by name. Parses JSON text payloads when present."""
        if not self._initialized:
            raise GlyphError("call initialize() before call_tool()")
        result = await self._request("tools/call", {"name": name, "arguments": args})
        # MCP returns {content: [{type: "text", text: "..."}], isError?: bool}.
        # Surface tool-side errors as McpProtocolError so callers don't have to
        # branch on shape.
        if isinstance(result, dict) and result.get("isError"):
            message = _extract_text(result) or f"tool {name} reported isError"
            raise McpProtocolError(f"{name}: {message}")
        content = result.get("content", []) if isinstance(result, dict) else []
        if content and isinstance(content[0], dict) and content[0].get("type") == "text":
            text = content[0].get("text", "")
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text
        return result

    async def _request(self, method: str, params: dict[str, Any]) -> Any:
        async with self._request_lock:
            self._next_id += 1
            req_id = self._next_id
            await self._send({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})
            while True:
                msg = await self._recv()
                if msg.get("id") == req_id:
                    if "error" in msg:
                        err = msg["error"]
                        raise McpProtocolError(
                            f"{method}: {err.get('message')} ({err.get('code')})"
                        )
                    return msg.get("result")
                # Notifications and other ids: ignore for the simple client. The
                # full implementation will dispatch notifications/progress to a
                # callback (PR-7).

    async def _send_notification(self, method: str, params: dict[str, Any]) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": params})

    async def _send(self, msg: dict[str, Any]) -> None:
        line = (json.dumps(msg) + "\n").encode()
        if self._proc.stdin is None:
            raise GlyphError("MCP subprocess has no stdin")
        self._proc.stdin.write(line)
        await self._proc.stdin.drain()

    async def _recv(self) -> dict[str, Any]:
        # Framing note: MCP stdio uses newline-delimited JSON (not LSP-style
        # Content-Length headers). json.dumps escapes literal newlines inside
        # string values, so one line == one message is always safe here.
        if self._proc.stdout is None:
            raise GlyphError("MCP subprocess has no stdout")
        line = await self._proc.stdout.readline()
        if not line:
            # stderr is being drained into self._stderr_buf in the background;
            # surface whatever's been collected so far in the error message.
            raise GlyphError(f"MCP server closed stdout. stderr:\n{self._stderr_text()}")
        try:
            parsed = json.loads(line.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise McpProtocolError(f"non-JSON line from server: {line!r}") from e
        if not isinstance(parsed, dict):
            raise McpProtocolError(f"expected JSON object from server, got {type(parsed).__name__}")
        return parsed


def _extract_text(result: dict[str, Any]) -> str | None:
    content = result.get("content") if isinstance(result, dict) else None
    if isinstance(content, list) and content:
        first = content[0]
        if isinstance(first, dict):
            text = first.get("text")
            if isinstance(text, str):
                return text
    return None
