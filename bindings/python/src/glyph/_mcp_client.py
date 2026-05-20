"""MCP stdio JSON-RPC client. Internal."""

from __future__ import annotations

import asyncio
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

    @classmethod
    @asynccontextmanager
    async def spawn(cls, args: list[str]) -> AsyncIterator[McpClient]:
        """Spawn the MCP server, yield a client, terminate on exit."""
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        client = cls(proc)
        try:
            yield client
        finally:
            if proc.returncode is None:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                except ProcessLookupError:
                    # Already exited between the returncode check and terminate().
                    pass

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
        result = await self._request(
            "tools/call", {"name": name, "arguments": args}
        )
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
        self._next_id += 1
        req_id = self._next_id
        await self._send(
            {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params}
        )
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
        if self._proc.stdout is None:
            raise GlyphError("MCP subprocess has no stdout")
        line = await self._proc.stdout.readline()
        if not line:
            stderr = ""
            if self._proc.stderr is not None:
                stderr = (await self._proc.stderr.read()).decode(
                    "utf-8", errors="replace"
                )
            raise GlyphError(f"MCP server closed stdout. stderr:\n{stderr}")
        try:
            parsed = json.loads(line.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise McpProtocolError(f"non-JSON line from server: {line!r}") from e
        if not isinstance(parsed, dict):
            raise McpProtocolError(
                f"expected JSON object from server, got {type(parsed).__name__}"
            )
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
