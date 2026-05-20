import glyph


def test_version_is_set():
    assert glyph.__version__.startswith("0.")


def test_exceptions_importable():
    from glyph import GlyphError, NodeNotFoundError

    assert issubclass(NodeNotFoundError, GlyphError)
