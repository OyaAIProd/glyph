"""Singleton MCP client. Spawned on first call, cached for the process.

The MCP server is expensive to start (DuckDB engine, ESM module graph) so we
keep one running for the whole Python process. Tests that want isolation can
call :func:`shutdown_runtime` between cases.

Sync / async bridge
-------------------
The public entrypoint :func:`call_verb` is synchronous so users don't need to
know about asyncio. Internally we drive the async client on a **dedicated
worker thread** that owns a long-running asyncio event loop. Sync calls are
dispatched via :func:`asyncio.run_coroutine_threadsafe`, then awaited with
``Future.result()``.

Why a worker thread (vs. ``loop.run_until_complete`` on the calling thread)?
The calling thread may already have a running event loop — Jupyter cells,
anyio task contexts, ``asyncio.run(...)`` wrappers — and re-entering an active
loop is illegal and raises ``RuntimeError: This event loop is already
running``. The worker-thread design sidesteps this entirely: the calling
thread blocks on a ``concurrent.futures.Future`` (which is sync), the worker
loop drives the I/O, and the two communicate via thread-safe primitives.

Lifecycle
---------
- The worker is started **lazily** on the first :func:`call_verb`, so
  ``import glyph`` stays cheap (no thread spin-up cost).
- :func:`shutdown_runtime` (also registered via ``atexit``) stops the loop,
  joins the worker, and drops the cached client. The next call respawns.

Threading
---------
A module-level ``threading.Lock`` serializes worker startup + shutdown so
two threads can't race to spin up two workers. ``call_verb`` itself does
NOT hold the lock while the coroutine runs — the worker loop handles
fan-in internally via the asyncio scheduler, and holding the lock would
serialize all sync calls (negating the point of a worker loop).
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
_worker_loop: asyncio.AbstractEventLoop | None = None
_worker_thread: threading.Thread | None = None
_worker_ready = threading.Event()
_lock = threading.Lock()

# Default per-call timeout for the worker future. The MCP verbs are I/O-bound
# (a Node subprocess round-trip + DuckDB query) and on warm caches finish in
# well under a second; a render against a fresh fixture is typically <1s.
# 60s is generous enough for cold-start renders on slow CI runners without
# letting a true hang (e.g. wedged subprocess) block the user forever.
_CALL_TIMEOUT_SECONDS = 60.0


def _worker_main() -> None:
    """Body of the worker thread: own an event loop until shutdown.

    The loop is created HERE (not in the calling thread) so that
    ``asyncio.get_event_loop()`` resolves correctly for any coroutines
    scheduled onto it via ``run_coroutine_threadsafe``. We signal readiness
    via ``_worker_ready`` so :func:`call_verb` knows it's safe to start
    submitting work.
    """
    global _worker_loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _worker_loop = loop
    _worker_ready.set()
    try:
        loop.run_forever()
    finally:
        # Drain any pending tasks before closing — otherwise asyncio logs
        # "Task was destroyed but it is pending!" warnings on shutdown.
        try:
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            if pending:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        finally:
            loop.close()


def _ensure_worker() -> asyncio.AbstractEventLoop:
    """Start the worker thread on first use; return its event loop.

    Acquires ``_lock`` only during the spin-up so concurrent first calls
    don't race. Subsequent calls take the fast path (no lock).
    """
    global _worker_thread
    if _worker_loop is not None and _worker_thread is not None and _worker_thread.is_alive():
        return _worker_loop
    with _lock:
        # Double-checked: another thread may have started the worker while
        # we were blocked on the lock.
        if _worker_loop is not None and _worker_thread is not None and _worker_thread.is_alive():
            return _worker_loop
        _worker_ready.clear()
        thread = threading.Thread(
            target=_worker_main,
            name="glyph-mcp-worker",
            daemon=True,
        )
        thread.start()
        _worker_thread = thread
    # Wait for the worker to publish its loop before returning. The
    # threading.Event handles the memory barrier so the loop reference is
    # visible across threads.
    _worker_ready.wait(timeout=5.0)
    if _worker_loop is None:
        raise GlyphError("glyph worker thread failed to start within 5 s")
    return _worker_loop


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

    Dispatches the call onto the worker thread's event loop via
    :func:`asyncio.run_coroutine_threadsafe`, then blocks on the resulting
    ``concurrent.futures.Future``. Safe to call from:

    - plain sync scripts (no event loop)
    - pytest test functions (sync or async)
    - Jupyter cells (which run inside a tornado/anyio loop)
    - any thread that holds its own asyncio loop

    The returned value is whatever the verb's text content parses to (usually
    a JSON dict). Errors raised by the server come back as
    :class:`glyph.exceptions.McpProtocolError`.
    """
    loop = _ensure_worker()

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

    future = asyncio.run_coroutine_threadsafe(_go(), loop)
    try:
        return future.result(timeout=_CALL_TIMEOUT_SECONDS)
    except TimeoutError as e:
        # Cancel the in-flight coroutine so the worker loop doesn't keep
        # spinning on a wedged subprocess. The cancellation is best-effort:
        # if the coroutine is blocked in a sync C extension it may still
        # need to finish on its own.
        future.cancel()
        raise GlyphError(f"glyph.{name} timed out after {_CALL_TIMEOUT_SECONDS:.0f}s") from e


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
    """Tear down the singleton client and stop the worker thread.

    Registered via :mod:`atexit` so well-behaved processes don't leak the
    Node subprocess. Tests that want a clean slate between cases can call
    this directly; the next :func:`call_verb` will respawn on demand.
    """
    global _client, _client_ctx, _worker_loop, _worker_thread
    with _lock:
        loop = _worker_loop
        thread = _worker_thread
        if loop is not None and _client is not None and _client_ctx is not None:
            # __aexit__ on McpClient.spawn handles SIGTERM + stderr-task
            # cancellation. Schedule it on the worker loop and wait via the
            # cross-thread future, so we never re-enter the loop from here.
            try:
                fut = asyncio.run_coroutine_threadsafe(
                    _client_ctx.__aexit__(None, None, None), loop
                )
                # 10s is enough for a clean SIGTERM + stderr drain on every
                # platform we've seen; longer than that and we just give up
                # and let the daemon thread tear down on process exit.
                with contextlib.suppress(Exception):
                    fut.result(timeout=10.0)
            except RuntimeError:
                # Loop already closed — nothing to drain.
                pass
        _client = None
        _client_ctx = None

        if loop is not None and not loop.is_closed():
            # call_soon_threadsafe is the documented way to stop a loop
            # owned by another thread.
            with contextlib.suppress(RuntimeError):
                loop.call_soon_threadsafe(loop.stop)
        if thread is not None and thread.is_alive():
            thread.join(timeout=5.0)
        _worker_loop = None
        _worker_thread = None
        _worker_ready.clear()


atexit.register(shutdown_runtime)
