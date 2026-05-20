from importlib.metadata import version as _pkg_version

import glyph


def test_version_is_set():
    assert glyph.__version__.startswith("0.")


def test_version_matches_packaged():
    """Catch drift between `__version__` and the installed metadata version.

    Both must move together — a release script that bumps one and forgets the
    other ships a broken package.
    """
    assert _pkg_version("glyph-charts") == glyph.__version__


def test_exceptions_importable():
    from glyph import GlyphError, McpProtocolError, NodeNotFoundError, SpecValidationError

    assert issubclass(NodeNotFoundError, GlyphError)
    assert issubclass(McpProtocolError, GlyphError)
    assert issubclass(SpecValidationError, GlyphError)
