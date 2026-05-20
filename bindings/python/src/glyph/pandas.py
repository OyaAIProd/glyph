"""Pandas DataFrame ↔ Glyph inline-data shape.

This module is loaded lazily by :func:`glyph.render` when the caller passes a
``data=`` keyword. Importing ``glyph.pandas`` at the top of a user script is
fine, but the package's top-level ``import glyph`` doesn't touch it so the
core path stays pandas-free for users who don't need it.

The on-the-wire shape exported here — ``{"values": [<row-dict>, ...]}`` — is
the canonical "inline rows" envelope. ``glyph.render`` unwraps it and calls
``glyph_import`` with ``kind="json-rows"`` so the rows are registered as a
DuckDB view; the resulting name is then threaded back into the spec as
``data.source``. The TS-side DataSourceSchema is strict and does *not* accept
``values`` directly, so an end-to-end DataFrame render needs that extra
``glyph_import`` round-trip — see ``glyph.__init__.render``.

Conversions applied per cell:
  * ``float`` NaN → ``None`` (becomes JSON ``null``)
  * ``pandas.NA`` (nullable-int / nullable-bool sentinel) → ``None``
  * ``pandas.NaT`` (datetime "not a time") → ``None``
  * ``pandas.Timestamp`` → ISO-8601 string
  * everything else passes through unchanged so the JSON-RPC layer can
    serialize ints / floats / strings / bools natively.
"""

from __future__ import annotations

import math
from typing import Any

try:
    import pandas as pd  # type: ignore[import-untyped]
except ImportError as e:  # pragma: no cover — exercised in env without pandas
    raise ImportError(
        "glyph.pandas requires `pandas` — install with `pip install glyph[pandas]`"
    ) from e


def _coerce(value: Any) -> Any:
    """Map a single DataFrame cell to a JSON-RPC-safe value.

    Order matters: the ``pd.NA`` / ``pd.NaT`` sentinel checks have to run
    *before* the Timestamp branch because in pandas 3.x ``NaT`` is its own
    ``NaTType`` singleton (not a ``Timestamp`` subclass), and ``pd.NA`` raises
    a truth-value error on ``==`` so we have to use ``is`` / ``pd.isna``.
    """
    # pandas' nullable sentinels — distinct from float('nan'). Use the
    # combined ``pd.isna`` check rather than ``is pd.NA`` so we catch NaT
    # (whose type differs across pandas versions) in the same branch.
    # ``pd.isna`` returns a numpy.bool_ for scalars; coerce via ``bool()``
    # so the branch predicate is well-typed. Guarded by a try/except because
    # ``pd.isna`` raises on objects (e.g. lists) that don't have an obvious
    # NA representation.
    try:
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        # Arrays / containers fall through to the type-specific branches below.
        pass

    # Timestamps. ``pd.isna`` above already short-circuited NaT.
    if isinstance(value, pd.Timestamp):
        return value.isoformat()

    # Plain float NaN. ``math.isnan`` only accepts floats, hence the type
    # guard. ``pd.isna`` above already catches this, but the explicit branch
    # is a belt-and-braces fallback in case the user passes a pre-coerced
    # numpy scalar that bypasses the broad ``pd.isna`` check on some versions.
    if isinstance(value, float) and math.isnan(value):
        return None

    return value


def dataframe_to_inline_data(df: pd.DataFrame) -> dict[str, list[dict[str, Any]]]:
    """Serialize a DataFrame to Glyph's inline-rows envelope.

    Args:
        df: A pandas DataFrame. Column dtypes are not introspected; values are
            coerced cell-by-cell so mixed-dtype frames work correctly.

    Returns:
        ``{"values": [<row-dict>, ...]}`` — one dict per row, column names as
        keys. Missing data (float NaN, pandas NA/NaT) becomes ``None``.
        ``pd.Timestamp`` columns become ISO-8601 strings.

    Notes:
        We go through ``DataFrame.to_dict(orient="records")`` rather than
        iterating ``itertuples`` because the former handles MultiIndex column
        names by collapsing them to tuples — same behaviour the rest of the
        Glyph TypeScript surface assumes when it accepts a row dict.
    """
    records = df.to_dict(orient="records")
    cleaned: list[dict[str, Any]] = []
    for row in records:
        cleaned.append({key: _coerce(val) for key, val in row.items()})
    return {"values": cleaned}
