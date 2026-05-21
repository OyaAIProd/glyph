/**
 * Track A4 — declarative sliders.
 *
 * `attachSlider` builds a single labelled `<input type="range">` inside a
 * container and fires `onChange` with the parsed numeric value on every
 * `input` event. `bootSlidersFromSpec` reads `spec.interactive.sliders`
 * and attaches one slider per entry, then debounces a caller-supplied
 * re-render function so dragging the slider keeps the chart in sync
 * without flooding work on every input tick.
 *
 * The static-SVG renderer in `@glyph/core` ignores `interactive.sliders`,
 * so snapshot tests of slider-bearing specs stay byte-stable. The field
 * is a forward-declared description of which caller-provided variables
 * the host page is willing to expose as a knob — `@glyph/live` (this
 * module) is the only consumer.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Declarative config for one interactive slider. Mirrored 1:1 in
 * `packages/core/src/spec/schemas.ts` via the `SliderConfigSchema` so the
 * spec round-trips with a `z.infer`-able type.
 */
export interface SliderConfig {
  /**
   * Variable name the slider drives. Becomes the key in the overrides
   * map passed to `rerenderFn`. Caller-defined — typically a free
   * variable in `spec.data.expr` (function-shape data) or any other
   * downstream parameter the re-render path knows about.
   */
  readonly field: string;
  /** Inclusive minimum value (left edge of the range). */
  readonly min: number;
  /** Inclusive maximum value (right edge of the range). */
  readonly max: number;
  /** Slider granularity. Must be > 0. */
  readonly step: number;
  /** Initial slider position. Clamped into [min, max] at attach time. */
  readonly value: number;
  /** Optional UI label. Defaults to the `field` name when omitted. */
  readonly label?: string;
}

/**
 * Minimal spec surface this module reads. We intentionally keep the
 * dependency on `@glyph/core` types loose so this package stays
 * standalone and the static renderer's evolution doesn't force a
 * version bump here.
 */
export interface SliderSpecShape {
  readonly interactive?: {
    readonly sliders?: ReadonlyArray<SliderConfig>;
  };
}

/** Handle returned by `attachSlider`. */
export interface AttachedSlider {
  /** The `<input type="range">` element the slider is driven by. */
  readonly input: HTMLInputElement;
  /** The wrapper element containing the label, input, and value readout. */
  readonly wrapper: HTMLElement;
  /** Detach the change listener + remove the wrapper from the DOM. */
  dispose(): void;
}

/** Handle returned by `bootSlidersFromSpec`. */
export interface BootedSliders {
  /** One handle per slider attached, in declaration order. */
  readonly sliders: ReadonlyArray<AttachedSlider>;
  /** Detach every slider + cancel any pending debounced re-render. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// attachSlider
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Build a labelled range input inside `container` and fire `onChange`
 * with the parsed numeric value on every `input` event. The current
 * value is also rendered as a small readout next to the slider.
 *
 * Returns an `AttachedSlider` handle so the caller can detach the
 * listener + remove the DOM nodes when the host view tears down.
 */
export function attachSlider(
  container: HTMLElement,
  config: SliderConfig,
  onChange: (value: number) => void,
): AttachedSlider {
  if (!(config.step > 0)) {
    throw new Error(`attachSlider: step must be > 0, got ${config.step}`);
  }
  if (config.min > config.max) {
    throw new Error(`attachSlider: min (${config.min}) > max (${config.max})`);
  }

  const doc = container.ownerDocument;
  const initial = clamp(config.value, config.min, config.max);

  const wrapper = doc.createElement("div");
  wrapper.className = "glyph-slider";
  wrapper.style.cssText =
    "display:flex;align-items:center;gap:8px;margin:6px 0;font:12px system-ui;";

  const labelEl = doc.createElement("label");
  labelEl.textContent = `${config.label ?? config.field}:`;
  labelEl.style.cssText = "min-width:60px;";

  const input = doc.createElement("input");
  input.type = "range";
  input.min = String(config.min);
  input.max = String(config.max);
  input.step = String(config.step);
  input.value = String(initial);
  input.setAttribute("data-glyph-slider-field", config.field);
  input.style.cssText = "flex:1;min-width:120px;";

  const readout = doc.createElement("span");
  readout.className = "glyph-slider-value";
  readout.textContent = String(initial);
  readout.style.cssText = "min-width:40px;text-align:right;font-variant-numeric:tabular-nums;";

  wrapper.appendChild(labelEl);
  wrapper.appendChild(input);
  wrapper.appendChild(readout);
  container.appendChild(wrapper);

  const onInput = (): void => {
    const parsed = Number.parseFloat(input.value);
    if (!Number.isFinite(parsed)) return;
    readout.textContent = String(parsed);
    onChange(parsed);
  };
  input.addEventListener("input", onInput);

  return {
    input,
    wrapper,
    dispose() {
      input.removeEventListener("input", onInput);
      wrapper.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// bootSlidersFromSpec
// ---------------------------------------------------------------------------

/**
 * Internal: rAF-friendly debounce. Uses a plain `setTimeout` window so
 * happy-dom tests can advance the timer deterministically. Defaults to
 * ~16ms (one frame at 60Hz) which keeps drag latency under a frame
 * while coalescing redundant `input` events when the user drags fast.
 */
function debounce<T extends (...args: never[]) => void>(
  fn: T,
  windowMs: number,
): { call: (...args: Parameters<T>) => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: Parameters<T> | undefined;
  return {
    call(...args: Parameters<T>): void {
      lastArgs = args;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (lastArgs) fn(...lastArgs);
      }, windowMs);
    },
    cancel(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

/** Options for `bootSlidersFromSpec`. */
export interface BootSlidersOptions {
  /**
   * Debounce window in milliseconds. Defaults to 16ms (~1 frame). Set
   * to 0 to fire the re-render synchronously on every input tick (the
   * test suite uses 0 to avoid faking timers).
   */
  readonly debounceMs?: number;
}

/**
 * Read `spec.interactive.sliders`, attach one `attachSlider` per entry
 * into `rootElement`, and debounce a caller-supplied `rerenderFn` that
 * receives the accumulated overrides map on every change. The overrides
 * object is keyed by `SliderConfig.field` so the caller can splice it
 * into whatever variable bag drives their re-render path (function-shape
 * data via `spec.data.expr`, an MCP arg, etc.).
 *
 * Returns a `BootedSliders` handle for teardown. When `spec.interactive`
 * or `spec.interactive.sliders` is missing / empty, returns a handle
 * with `sliders: []` (no-op).
 */
export function bootSlidersFromSpec(
  rootElement: HTMLElement,
  spec: SliderSpecShape,
  rerenderFn: (overrides: Record<string, number>) => void,
  options: BootSlidersOptions = {},
): BootedSliders {
  const configs = spec.interactive?.sliders ?? [];
  if (configs.length === 0) {
    return { sliders: [], dispose() {} };
  }

  // Seed the overrides with each slider's initial value so the first
  // re-render after a change still carries every variable (the caller
  // doesn't need to track partial state).
  const overrides: Record<string, number> = {};
  for (const cfg of configs) {
    overrides[cfg.field] = clamp(cfg.value, cfg.min, cfg.max);
  }

  const debounceMs = options.debounceMs ?? 16;
  const debounced =
    debounceMs > 0
      ? debounce(rerenderFn, debounceMs)
      : { call: rerenderFn, cancel: () => {} };

  const attached: AttachedSlider[] = [];
  for (const cfg of configs) {
    const handle = attachSlider(rootElement, cfg, (v) => {
      overrides[cfg.field] = v;
      debounced.call({ ...overrides });
    });
    attached.push(handle);
  }

  return {
    sliders: attached,
    dispose() {
      debounced.cancel();
      for (const a of attached) a.dispose();
    },
  };
}
