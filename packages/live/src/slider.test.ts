import { describe, expect, it } from "vitest";
import {
  type AttachedSlider,
  type SliderConfig,
  attachSlider,
  bootSlidersFromSpec,
} from "./index.js";

function mountContainer(): HTMLElement {
  document.body.innerHTML = `<div id="root"></div>`;
  return document.querySelector("#root") as HTMLElement;
}

function fireInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("attachSlider — event handler", () => {
  it("fires onChange with the parsed numeric value on input", () => {
    const root = mountContainer();
    const seen: number[] = [];
    const cfg: SliderConfig = { field: "k", min: 0, max: 10, step: 1, value: 3 };
    const handle = attachSlider(root, cfg, (v) => seen.push(v));

    expect(handle.input.value).toBe("3");
    fireInput(handle.input, "7");

    expect(seen).toEqual([7]);
    // Readout mirrors the current value.
    expect(root.querySelector(".glyph-slider-value")?.textContent).toBe("7");
  });

  it("honors min / max / step on the underlying <input>", () => {
    const root = mountContainer();
    const cfg: SliderConfig = { field: "amplitude", min: -1.5, max: 2.5, step: 0.25, value: 0 };
    const handle = attachSlider(root, cfg, () => {});

    expect(handle.input.min).toBe("-1.5");
    expect(handle.input.max).toBe("2.5");
    expect(handle.input.step).toBe("0.25");
    // The data-field attribute lets downstream code identify which knob fired.
    expect(handle.input.getAttribute("data-glyph-slider-field")).toBe("amplitude");
  });

  it("falls back to the field name when no label is set, and uses label when provided", () => {
    const root = mountContainer();
    const a = attachSlider(root, { field: "k", min: 0, max: 1, step: 1, value: 0 }, () => {});
    expect(a.wrapper.querySelector("label")?.textContent).toBe("k:");

    const root2 = mountContainer();
    const b = attachSlider(
      root2,
      { field: "k", min: 0, max: 1, step: 1, value: 0, label: "Spring constant" },
      () => {},
    );
    expect(b.wrapper.querySelector("label")?.textContent).toBe("Spring constant:");
  });

  it("clamps the initial value into [min, max]", () => {
    const root = mountContainer();
    const cfg: SliderConfig = { field: "k", min: 0, max: 5, step: 1, value: 99 };
    const handle = attachSlider(root, cfg, () => {});
    // happy-dom mirrors the underlying clamp behavior of input[type=range];
    // we set the value attribute to the clamped value so subsequent reads
    // return the clamped value regardless of the DOM implementation.
    expect(handle.input.value).toBe("5");
  });

  it("rejects non-positive step + inverted bounds", () => {
    const root = mountContainer();
    expect(() =>
      attachSlider(root, { field: "k", min: 0, max: 1, step: 0, value: 0 }, () => {}),
    ).toThrow(/step must be > 0/);
    expect(() =>
      attachSlider(root, { field: "k", min: 5, max: 1, step: 1, value: 0 }, () => {}),
    ).toThrow(/min .* > max/);
  });

  it("dispose() removes the wrapper + detaches the listener", () => {
    const root = mountContainer();
    const seen: number[] = [];
    const handle = attachSlider(
      root,
      { field: "k", min: 0, max: 10, step: 1, value: 0 },
      (v) => seen.push(v),
    );
    handle.dispose();

    expect(root.querySelector(".glyph-slider")).toBeNull();
    // Re-firing on the detached element is a no-op.
    fireInput(handle.input, "5");
    expect(seen).toEqual([]);
  });
});

describe("bootSlidersFromSpec — attaches N sliders for N entries", () => {
  it("returns an empty handle when spec.interactive.sliders is missing", () => {
    const root = mountContainer();
    const booted = bootSlidersFromSpec(root, {}, () => {});
    expect(booted.sliders).toHaveLength(0);
    expect(root.querySelectorAll(".glyph-slider")).toHaveLength(0);
  });

  it("attaches one slider per entry, in declaration order", () => {
    const root = mountContainer();
    const booted = bootSlidersFromSpec(
      root,
      {
        interactive: {
          sliders: [
            { field: "a", min: 0, max: 1, step: 0.1, value: 0.5 },
            { field: "b", min: -10, max: 10, step: 1, value: 0, label: "Beta" },
            { field: "c", min: 0, max: 100, step: 5, value: 25 },
          ],
        },
      },
      () => {},
      { debounceMs: 0 },
    );

    expect(booted.sliders).toHaveLength(3);
    const wrappers = Array.from(root.querySelectorAll(".glyph-slider"));
    expect(wrappers).toHaveLength(3);
    expect(wrappers[0]?.querySelector("label")?.textContent).toBe("a:");
    expect(wrappers[1]?.querySelector("label")?.textContent).toBe("Beta:");
    expect(wrappers[2]?.querySelector("label")?.textContent).toBe("c:");
  });

  it("calls rerenderFn with the merged overrides map (every field, every time)", () => {
    const root = mountContainer();
    const calls: Record<string, number>[] = [];
    const booted = bootSlidersFromSpec(
      root,
      {
        interactive: {
          sliders: [
            { field: "a", min: 0, max: 10, step: 1, value: 1 },
            { field: "b", min: 0, max: 10, step: 1, value: 2 },
          ],
        },
      },
      (o) => calls.push(o),
      { debounceMs: 0 },
    );

    const [sa, sb] = booted.sliders as [AttachedSlider, AttachedSlider];
    fireInput(sa.input, "7");
    fireInput(sb.input, "9");

    expect(calls).toEqual([
      { a: 7, b: 2 }, // b retains its seeded initial value
      { a: 7, b: 9 }, // a retains the previous override
    ]);
  });

  it("dispose() tears down all sliders", () => {
    const root = mountContainer();
    const booted = bootSlidersFromSpec(
      root,
      {
        interactive: {
          sliders: [
            { field: "a", min: 0, max: 1, step: 1, value: 0 },
            { field: "b", min: 0, max: 1, step: 1, value: 0 },
          ],
        },
      },
      () => {},
    );
    expect(root.querySelectorAll(".glyph-slider")).toHaveLength(2);
    booted.dispose();
    expect(root.querySelectorAll(".glyph-slider")).toHaveLength(0);
  });
});

describe("bootSlidersFromSpec — debouncing", () => {
  it("coalesces back-to-back inputs into a single re-render with the latest value", async () => {
    const root = mountContainer();
    const calls: Record<string, number>[] = [];
    const booted = bootSlidersFromSpec(
      root,
      {
        interactive: {
          sliders: [{ field: "k", min: 0, max: 100, step: 1, value: 0 }],
        },
      },
      (o) => calls.push(o),
      { debounceMs: 16 },
    );

    const [s] = booted.sliders as [AttachedSlider];
    fireInput(s.input, "10");
    fireInput(s.input, "20");
    fireInput(s.input, "30");

    // No re-render should have fired yet inside the debounce window.
    expect(calls).toHaveLength(0);

    // Wait past the debounce window — exactly one collapsed call should land.
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toEqual([{ k: 30 }]);
  });

  it("debounceMs: 0 short-circuits the debouncer (sync re-render every input)", () => {
    const root = mountContainer();
    const calls: number[] = [];
    const booted = bootSlidersFromSpec(
      root,
      {
        interactive: {
          sliders: [{ field: "k", min: 0, max: 10, step: 1, value: 0 }],
        },
      },
      (o) => calls.push(o.k as number),
      { debounceMs: 0 },
    );
    const [s] = booted.sliders as [AttachedSlider];
    fireInput(s.input, "3");
    fireInput(s.input, "7");
    expect(calls).toEqual([3, 7]);
  });
});
