"""Tests for the async MCP stdio client (`glyph._mcp_client`)."""

from __future__ import annotations

from pathlib import Path

import pytest

from glyph._mcp_client import McpClient


@pytest.mark.asyncio
async def test_initialize_returns_capabilities(mcp_server_args: list[str]) -> None:
    """The client can perform the MCP initialize handshake."""
    async with McpClient.spawn(mcp_server_args) as client:
        result = await client.initialize()
        assert result["serverInfo"]["name"] == "glyph-mcp"
        assert "tools" in result["capabilities"]


@pytest.mark.asyncio
async def test_list_tools_returns_full_surface(mcp_server_args: list[str]) -> None:
    """All 49 verbs are exposed."""
    async with McpClient.spawn(mcp_server_args) as client:
        await client.initialize()
        tools = await client.list_tools()
        names = [t["name"] for t in tools]
        assert "glyph_render" in names
        assert "glyph_audit_spec" in names
        assert len(names) >= 49


@pytest.mark.asyncio
async def test_call_describe_round_trip(
    mcp_server_args: list[str], rides_csv_path: Path
) -> None:
    """A real describe call works end-to-end against the live MCP server."""
    async with McpClient.spawn(mcp_server_args) as client:
        await client.initialize()
        result = await client.call_tool(
            "glyph_describe", {"source": str(rides_csv_path)}
        )
        # glyph_describe returns {columns: [{name, suggestedType, ...}], rowCount: N}.
        # Assert the shape rather than a single key so a future renaming of either
        # field fails loudly.
        assert isinstance(result, dict)
        assert isinstance(result.get("columns"), list)
        assert len(result["columns"]) > 0
        first_col = result["columns"][0]
        assert "name" in first_col
        assert "suggestedType" in first_col
        assert isinstance(result.get("rowCount"), int)
        assert result["rowCount"] > 0


@pytest.mark.asyncio
async def test_protocol_error_raises(mcp_server_args: list[str]) -> None:
    """Unknown verbs raise McpProtocolError, not generic Exception."""
    from glyph.exceptions import McpProtocolError

    async with McpClient.spawn(mcp_server_args) as client:
        await client.initialize()
        with pytest.raises(McpProtocolError):
            await client.call_tool("glyph_does_not_exist", {})
