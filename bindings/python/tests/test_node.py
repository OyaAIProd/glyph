"""Tests for `glyph._node` — Node + MCP-binary resolution."""

from __future__ import annotations

from pathlib import Path

import pytest

from glyph._node import find_node, resolve_mcp_args
from glyph.exceptions import NodeNotFoundError


def test_find_node_returns_path_when_available() -> None:
    """Node is on PATH in CI / dev machines; find_node returns a real path."""
    path = find_node()
    assert isinstance(path, Path)
    assert path.exists()


def test_find_node_raises_when_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """When PATH is empty, find_node raises NodeNotFoundError naming Node 20."""
    # Strip PATH and pivot cwd to a temp dir so shutil.which has nowhere to
    # find ``node`` — empty PATH on POSIX would still resolve a ``./node``
    # next to the test process.
    monkeypatch.setenv("PATH", "")
    monkeypatch.chdir(tmp_path)
    # Some platforms fall back to ``os.defpath`` (e.g. ``/bin:/usr/bin``) when
    # PATH is unset; force an empty defpath too so the resolution is truly
    # closed.
    monkeypatch.setattr("os.defpath", "")

    with pytest.raises(NodeNotFoundError) as exc_info:
        find_node()
    # Error message must mention the required Node major so users know what
    # to install.
    assert "20" in str(exc_info.value)


def test_resolve_mcp_args_uses_default_resolution() -> None:
    """Default resolution: monorepo bin or npx, never empty.

    In a dev checkout (this repo) the monorepo branch finds
    ``packages/mcp/dist/bin.js`` and returns ``[node, bin.js]``. On a clean
    end-user install the same call falls through to ``[npx, -y, @glyph/mcp]``.
    Both shapes start with a ``node``/``npx`` executable path.
    """
    args = resolve_mcp_args()
    assert isinstance(args, list)
    assert len(args) >= 2
    first = Path(args[0])
    assert first.name in {"node", "npx", "npx.cmd", "node.exe"}


def test_resolve_mcp_args_respects_env_override(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """``GLYPH_MCP_BIN`` short-circuits resolution to ``[node, <bin>]``."""
    custom = tmp_path / "custom-bin.js"
    custom.write_text("// stub MCP server entry point\n")
    monkeypatch.setenv("GLYPH_MCP_BIN", str(custom))

    args = resolve_mcp_args()
    assert str(custom) in args
    # The override path is always ``[node, <bin>]`` — no npx wrapping.
    assert len(args) == 2
    assert Path(args[0]).name in {"node", "node.exe"}


def test_find_node_rejects_old_major(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """find_node raises when `node --version` reports a major below the minimum."""
    # Build a fake `node` shim that pretends to be Node 18 — exactly the kind
    # of environment that would otherwise crash later with a cryptic ESM
    # SyntaxError inside @glyph/mcp's bundle.
    fake_node = tmp_path / "node"
    fake_node.write_text("#!/bin/sh\necho 'v18.19.1'\n")
    fake_node.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.setattr("os.defpath", "")
    monkeypatch.chdir(tmp_path)

    with pytest.raises(NodeNotFoundError) as exc_info:
        find_node()
    # Message must tell the user (a) what's wrong (version too low) and
    # (b) what to install.
    msg = str(exc_info.value)
    assert "20" in msg
    assert "18" in msg


def test_find_node_rejects_unparseable_version(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A garbled `node --version` output is rejected explicitly."""
    fake_node = tmp_path / "node"
    fake_node.write_text("#!/bin/sh\necho 'not a version string'\n")
    fake_node.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.setattr("os.defpath", "")
    monkeypatch.chdir(tmp_path)

    with pytest.raises(NodeNotFoundError) as exc_info:
        find_node()
    assert "parse" in str(exc_info.value).lower()
