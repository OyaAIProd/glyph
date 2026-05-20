"""Resolve a Node.js runtime + the path to the MCP server.

This module owns the "how do we get a working `@glyph/mcp` server?" decision.
It tries, in order:

1. ``$GLYPH_MCP_BIN`` — explicit path to a pre-built ``bin.js`` (operators /
   air-gapped installs).
2. A monorepo-local ``packages/mcp/dist/bin.js`` reached by walking up from
   this file (Glyph developers running against an editable install).
3. ``npx -y @glyph/mcp`` — the production default that ships with ``pip
   install glyph`` for end users on a normal Node 20+ workstation.

A clear ``NodeNotFoundError`` is raised when neither ``node`` nor ``npx`` is
available; the message names the minimum required Node major so users know
what to install.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

from glyph.exceptions import NodeNotFoundError

__all__ = ["REQUIRED_NODE_MAJOR", "find_node", "find_npx", "resolve_mcp_args"]

REQUIRED_NODE_MAJOR = 20

# Matches the leading "v<major>" of `node --version` output, e.g. "v20.10.0\n"
_NODE_VERSION_RE = re.compile(r"^v(\d+)\.")


def find_node() -> Path:
    """Return the absolute path to ``node`` on PATH, or raise.

    Also enforces the minimum major version. Without the version check, a
    user on Node 18 would get a cryptic ESM `SyntaxError` from the MCP
    server's bundle — exactly the failure mode this module exists to prevent.

    Raises:
        NodeNotFoundError: When ``node`` is missing OR when its major version
            is below :data:`REQUIRED_NODE_MAJOR`. The message instructs the
            user how to fix it.
    """
    candidate = shutil.which("node")
    if candidate is None:
        raise NodeNotFoundError(
            f"Glyph requires Node.js >= {REQUIRED_NODE_MAJOR}, but `node` is not on PATH. "
            "Install from https://nodejs.org or set the GLYPH_MCP_BIN environment variable "
            "to point at a pre-built bin.js."
        )
    path = Path(candidate).resolve()
    _check_node_major(path)
    return path


def _check_node_major(node_path: Path) -> None:
    """Raise NodeNotFoundError if `node_path` reports a major < REQUIRED_NODE_MAJOR."""
    try:
        result = subprocess.run(
            [str(node_path), "--version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as e:
        raise NodeNotFoundError(
            f"Found `node` at {node_path} but `--version` failed: {e}. "
            f"Glyph requires Node.js >= {REQUIRED_NODE_MAJOR}."
        ) from e
    if result.returncode != 0:
        stderr = result.stderr.strip()
        raise NodeNotFoundError(
            f"`{node_path} --version` exited {result.returncode}; "
            f"stderr: {stderr!r}. Glyph requires Node.js >= {REQUIRED_NODE_MAJOR}."
        )
    match = _NODE_VERSION_RE.match(result.stdout.strip())
    if match is None:
        raise NodeNotFoundError(
            f"Could not parse Node version from {result.stdout.strip()!r}. "
            f"Glyph requires Node.js >= {REQUIRED_NODE_MAJOR}."
        )
    major = int(match.group(1))
    if major < REQUIRED_NODE_MAJOR:
        raise NodeNotFoundError(
            f"Found Node.js {result.stdout.strip()} at {node_path}, but Glyph requires "
            f">= {REQUIRED_NODE_MAJOR}. Upgrade from https://nodejs.org."
        )


def find_npx() -> Path | None:
    """Return the absolute path to ``npx`` on PATH, or ``None`` if absent."""
    candidate = shutil.which("npx")
    return Path(candidate).resolve() if candidate else None


def resolve_mcp_args() -> list[str]:
    """Return the argv list to spawn the MCP server subprocess.

    Resolution order:
      1. ``$GLYPH_MCP_BIN`` — explicit path to a ``bin.js``.
      2. Monorepo-relative ``packages/mcp/dist/bin.js`` (dev checkout).
      3. ``npx -y @glyph/mcp`` (production default).

    Raises:
        NodeNotFoundError: When no node runtime can be located. The override
            and monorepo paths both require ``node``; the production path
            requires ``npx``.
    """
    # 1. Env override — always preferred when set.
    env_bin = os.environ.get("GLYPH_MCP_BIN")
    if env_bin:
        node = find_node()
        return [str(node), env_bin]

    # 2. Monorepo dev checkout: walk up from this file looking for the built
    # MCP bundle. A site-packages install will never find the bundle this way
    # (the package isn't inside the monorepo), so we transparently fall
    # through to the npx path below.
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "packages" / "mcp" / "dist" / "bin.js"
        if candidate.exists():
            node = find_node()
            return [str(node), str(candidate)]

    # 3. Production default: shell out to npx, which will fetch the package
    # on first run and cache it for subsequent invocations.
    npx = find_npx()
    if npx is None:
        raise NodeNotFoundError(
            "Neither GLYPH_MCP_BIN, a monorepo build, nor `npx` are available. "
            f"Install Node.js >= {REQUIRED_NODE_MAJOR} from https://nodejs.org."
        )
    return [str(npx), "-y", "@glyph/mcp"]
