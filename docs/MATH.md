# MATH

Glyph's math extension surface — declarative knobs that let agents author
animated, parametric, interactive math visualizations as JSON specs.

The static SVG renderer in `@glyph/core` stays byte-deterministic; anything
that needs a live re-render lives in `@glyph/live` and is opt-in via
optional spec fields the static path ignores.

## `interactive.sliders` — declarative knobs (Track A4)

Each entry in `spec.interactive.sliders` describes one numeric knob the
host page can expose as an `<input type="range">`. The static SVG
renderer **does not branch on this field** — a spec that only differs
by the contents of `interactive.sliders` produces a byte-identical SVG,
so snapshot tests stay stable when an author adds slider metadata.

`@glyph/live`'s `bootSlidersFromSpec()` is the consumer: it reads the
array, attaches one labelled slider per entry into a host element, and
debounces a caller-supplied re-render function so dragging the slider
keeps the chart in sync without flooding work on every input tick.

### Shape

```ts
interactive: {
  sliders: [
    {
      field: "k",      // variable name the slider drives
      min: 0,
      max: 10,
      step: 0.1,
      value: 1,        // initial position (clamped into [min, max])
      label: "Spring", // optional UI label; defaults to `field`
    },
  ],
}
```

### Minimal example

A damped spring `y = e^(-t/k) * cos(t)` with `k` exposed as a slider:

```ts
import { renderSpecToSvg } from "@glyph/core";
import { bootSlidersFromSpec } from "@glyph/live";

const spec = {
  data: {
    shape: "function" as const,
    x: { min: 0, max: 20, samples: 400 },
    expr: "exp(-x/1) * cos(x)",
  },
  mark: "line" as const,
  encoding: { x: "x", y: "y" },
  interactive: {
    sliders: [
      { field: "k", min: 0.5, max: 10, step: 0.1, value: 1, label: "Damping (k)" },
    ],
  },
};

const host = document.getElementById("chart")!;
host.innerHTML = renderSpecToSvg(spec);

bootSlidersFromSpec(host, spec, (overrides) => {
  const nextSpec = {
    ...spec,
    data: { ...spec.data, expr: `exp(-x/${overrides.k}) * cos(x)` },
  };
  host.innerHTML = renderSpecToSvg(nextSpec);
});
```

How the caller wires `overrides.<field>` into the next render is up to
the host page — typically by splicing the value into `spec.data.expr`,
into a downstream parameter the compile path knows about, or into any
other call the host's re-render path is structured around. The schema
itself does not constrain how the variable is used.

### Constraints

- Up to 8 sliders per spec (keeps the host UI from drowning in knobs).
- `step` must be strictly positive.
- `field` must be a 1–64 char string.
- Static SVG renderer ignores the field entirely. Existing snapshots of
  slider-bearing specs render the initial value and stay byte-identical
  to non-slider variants.
