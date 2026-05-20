"""Singleton MCP client. Spawned on first call, cached for the process.

The MCP server is expensive to start (DuckDB engine, ESM module graph) so we
keep one running for the whole Python process. Tests that want isolation can
call :func:`shutdown_runtime` between cases.

Sync / async bridge
-------------------
The public entrypoint :func:`call_verb` is synchronous so users don't need to
know about asyncio. Internally we drive the async client on a private event
loop owned by this module — this is correct for plain scripts and (mostly)
for ``pytest``, but it does **not** work when an event loop is already
running in the calling thread (Jupyter, Trio, anyio task contexts). PR6 will
add proper detection via ``asyncio.get_running_loop()`` and route to a
worker thread when needed; for now the limitation is intentional.

Threading
---------
A module-level ``threading.Lock`` serializes ``call_verb`` so two threads
can't race to advance the same private loop. Performance is fine for the
single-user CLI / notebook workflows S1 targets.
"""

from __future__ import annotations

import asyncio
import atexit
import contextlib
import threading
from typing import Any

from glyph._mcp_client import McpClient
from glyph.exceptions import GlyphError

_client: McpClient | None = None
_client_ctx: Any = None  # AsyncContextManager from McpClient.spawn
_loop: asyncio.AbstractEventLoop | None = None
_lock = threading.Lock()


def _get_loop() -> asyncio.AbstractEventLoop:
    """Lazily create — or recreate after a shutdown — the runtime event loop."""
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
    return _loop


def _is_client_alive(client: McpClient) -> bool:
    """Return False if the cached MCP subprocess has exited."""
    # Reach into the McpClient's owned process. Could be elevated to a public
    # property later; keeping it here for now since the singleton lifecycle
    # logic is the only legitimate consumer.
    proc = getattr(client, "_proc", None)
    return proc is not None and proc.returncode is None


async def _drop_dead_client() -> None:
    """Drop the cached client + its async-context handle. Idempotent."""
    global _client, _client_ctx
    if _client_ctx is not None:
        # Try to close cleanly. If the proc is already dead, __aexit__ on the
        # spawn ctx is still safe to invoke — it short-circuits on returncode.
        with contextlib.suppress(Exception):
            await _client_ctx.__aexit__(None, None, None)
    _client = None
    _client_ctx = None


async def _ensure_client() -> McpClient:
    """Spawn the MCP server on first use; respawn if the previous proc died."""
    global _client, _client_ctx
    if _client is not None and not _is_client_alive(_client):
        # The subprocess exited (crash, OOM, user killed it). Drop the stale
        # singleton so we don't deadlock on the next readline().
        await _drop_dead_client()
    if _client is None:
        # Enter the async context manager manually so we can keep the proc
        # alive across multiple call_verb invocations. shutdown_runtime() is
        # responsible for the matching __aexit__ at process teardown.
        _client_ctx = McpClient.spawn()
        _client = await _client_ctx.__aenter__()
        await _client.initialize()
    return _client


def call_verb(name: str, args: dict[str, Any]) -> Any:
    """Synchronous entrypoint into the async MCP client.

    The returned value is whatever the verb's text content parses to (usually
    a JSON dict). Errors raised by the server come back as
    :class:`glyph.exceptions.McpProtocolError`.

    Raises :class:`glyph.exceptions.GlyphError` if called from inside an
    already-running asyncio event loop (e.g. inside an ``async def``
    coroutine or a Jupyter cell). PR6 will route those callers to a worker
    thread automatically; for now they get a typed, actionable error
    instead of a confusing ``RuntimeError: This event loop is already
    running`` stack trace.
    """
    # Detect a running loop on the calling thread BEFORE we acquire the
    # module lock — otherwise a Jupyter user gets a long blocking trace
    # before the error surfaces.
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass  # No running loop — good, that's the supported sync case.
    else:
        raise GlyphError(
            "glyph.render / glyph.describe cannot be called from inside a "
            "running asyncio event loop (Jupyter, anyio, etc.). Run the "
            "call from a sync context, or wait for the Jupyter integration "
            "in a later release. To bypass for testing, run the call inside "
            "asyncio.to_thread(...)."
        )

    with _lock:
        loop = _get_loop()

        async def _go() -> Any:
            client = await _ensure_client()
            result = await client.call_tool(name, args)
            # glyph_render returns content = [image, text] when PNG
            # rasterization is enabled, so the existing _mcp_client.call_tool
            # — which only inspects content[0] — surfaces the raw envelope
            # for those calls. Unwrap it here so the public render() API
            # gets a parsed dict either way.
            if isinstance(result, dict) and "content" in result and "svg" not in result:
                result = _extract_text_payload(result) or result
            return result

        return loop.run_until_complete(_go())


def _extract_text_payload(envelope: dict[str, Any]) -> Any:
    """Find the first text-block in an MCP content envelope and parse it.

    Used as a fallback when the upstream client returns the raw envelope —
    happens for tools that prepend image/audio content (e.g. ``glyph_render``
    with PNG rasterization). Returns ``None`` if no text block is present.
    """
    import json

    content = envelope.get("content")
    if not isinstance(content, list):
        return None
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text", "")
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text
    return None


def shutdown_runtime() -> None:
    """Tear down the singleton client and close the runtime loop.

    Registered via :mod:`atexit` so well-behaved processes don't leak the
    Node subprocess. Tests that want a clean slate between cases can call
    this directly; the next :func:`call_verb` will respawn on demand.
    """
    global _client, _client_ctx, _loop
    with _lock:
        if _client is not None and _client_ctx is not None and _loop is not None:
            # __aexit__ on McpClient.spawn handles SIGTERM + stderr-task
            # cancellation. Suppress any teardown exception — atexit handlers
            # should never raise.
            with contextlib.suppress(Exception):
                _loop.run_until_complete(_client_ctx.__aexit__(None, None, None))
        _client = None
        _client_ctx = None
        if _loop is not None and not _loop.is_closed():
            with contextlib.suppress(Exception):
                _loop.close()
        _loop = None


atexit.register(shutdown_runtime)
