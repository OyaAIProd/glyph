"""Jupyter / IPython integration helpers.

The bulk of the integration lives on :class:`glyph.RenderResult` itself —
``_repr_svg_`` and ``_repr_mimebundle_`` mean a bare ``result`` cell renders
inline with no extra import. This module exists for the cases where the
caller wants to be explicit (or wants IPython-only conveniences).

Importing this module does **not** require IPython — the optional import is
deferred to the call sites so ``import glyph.jupyter`` stays cheap and works
even in a stripped-down environment. Functions that need IPython raise a
clear ``ImportError`` if it's missing.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from glyph.types import RenderResult


def display(result: RenderResult) -> None:
    """Render ``result`` inline using IPython's display machinery.

    Equivalent to ``IPython.display.display(result)``. Useful when you have
    multiple results to show in a single cell:

    >>> from glyph.jupyter import display
    >>> for spec in specs:
    ...     display(glyph.render(spec, data=df))

    Raises:
        ImportError: IPython is not installed. Install with
            ``pip install glyph-charts[jupyter]`` or ``pip install ipython``.
    """
    try:
        # Imported lazily so the rest of the module works in headless envs.
        from IPython.display import display as _ipy_display
    except ImportError as e:  # pragma: no cover — env-specific
        raise ImportError(
            "glyph.jupyter.display requires IPython. Install it with "
            "`pip install glyph-charts[jupyter]` or `pip install ipython`."
        ) from e
    _ipy_display(result)


def register_ipython_completions() -> None:
    """Future hook: register tab-completion handlers on the active IPython.

    Reserved for a later release that will expose verb-name completion and
    spec-key suggestions inside notebook cells. Calling this today is a
    no-op so notebook templates can wire it up unconditionally.
    """
    # Intentionally empty — leaves the door open without committing to a
    # specific completion shape in S1.
    return None
