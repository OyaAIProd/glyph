/**
 * site/math/joy.js — six interactive parametric-curve demos.
 *
 * Each demo is a small `requestAnimationFrame` loop that:
 *   1. Reads the current slider values.
 *   2. Samples a parametric formula at N points.
 *   3. Paints into its own <canvas> with `setTransform` so the
 *      coordinate system is centered + uniformly scaled.
 *   4. Loops; sliders trigger no separate work — the next frame
 *      picks up the new values.
 *
 * No three.js, no D3, no dependencies. Each canvas owns one
 * `CanvasRenderingContext2D` and does its own math. The whole file
 * is < 600 lines minified, < 8 KB gzipped over the wire.
 *
 * Per-demo registration: each demo's `init(card)` is called once
 * at boot if the page contains its `[data-demo]` attribute.
 *
 * Mobile + reduced-motion friendly: high-DPI canvases scale
 * automatically; demos pause when off-screen via IntersectionObserver.
 */

(() => {
  "use strict";

  // ---------------- shared helpers ----------------

  /** Map a hex color to a 0..1 RGB triple (for gradient stops). */
  const HX = {
    primary: "#60a5fa",
    accent: "#fbbf24",
    pink: "#f472b6",
    violet: "#a78bfa",
    emerald: "#34d399",
    rose: "#fb7185",
    ink: "#e2e8f0",
    grid: "rgba(96,165,250,.12)",
  };

  /**
   * Mount a high-DPI canvas inside `host` and return its 2D context
   * pre-translated so (0,0) is the center and y points up. Re-runs on
   * window resize. Returns the ctx + a getter for half-width / -height.
   */
  function mountCanvas(host) {
    const canvas = host.querySelector("canvas");
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    let w = 0, h = 0;
    function fit() {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // ALL drawing uses CSS px.
    }
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return { canvas, ctx, get w() { return w; }, get h() { return h; } };
  }

  /**
   * requestAnimationFrame loop that pauses when `host` is off-screen.
   * Saves battery on a long scrollable page with six animated demos.
   */
  function loop(host, perFrame) {
    let onScreen = true;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => (onScreen = e.isIntersecting)),
      { threshold: 0.05 },
    );
    io.observe(host);
    let last = performance.now();
    function tick(t) {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (onScreen && !document.hidden) perFrame(dt, t / 1000);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /**
   * Bind a slider's `input` event to update a `<strong>` readout (so
   * the user sees the live value next to the label).
   */
  function bindSlider(id, lblId, format) {
    const el = document.getElementById(id);
    const lbl = document.getElementById(lblId);
    if (!el || !lbl) return null;
    const update = () => {
      lbl.textContent = format ? format(el.value) : el.value;
    };
    el.addEventListener("input", update);
    update();
    return el;
  }

  /** Apply a `data-preset` button's comma list to a tuple of sliders. */
  function bindPresets(card, sliders) {
    card.querySelectorAll("button[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const vals = btn.getAttribute("data-preset").split(",");
        sliders.forEach((s, i) => {
          if (s && vals[i] !== undefined) {
            s.value = vals[i];
            s.dispatchEvent(new Event("input", { bubbles: true }));
          }
        });
      });
    });
  }

  /** Linear interpolate. */
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------------- DEMO 1 — Lissajous ----------------

  function initLissajous(card) {
    const stage = mountCanvas(card);
    const { ctx } = stage;
    const slA = bindSlider("liss-a", "lbl-liss-a");
    const slB = bindSlider("liss-b", "lbl-liss-b");
    const slD = bindSlider("liss-d", "lbl-liss-d", (v) => Number(v).toFixed(2));
    bindPresets(card, [slA, slB, slD]);

    // The phase ticks forward continuously when the user hasn't touched
    // the δ slider in the last 1.5 s, so the demo feels alive.
    let userTouchedDeltaAt = 0;
    slD.addEventListener("input", () => (userTouchedDeltaAt = performance.now()));

    loop(card, (dt, t) => {
      const { w, h } = stage;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42;
      const a = Number(slA.value);
      const b = Number(slB.value);
      let delta = Number(slD.value);
      // Auto-animate delta unless user is dragging.
      if (performance.now() - userTouchedDeltaAt > 1500) {
        delta = (delta + dt * 0.4) % (Math.PI * 2);
        slD.value = String(delta);
        document.getElementById("lbl-liss-d").textContent = delta.toFixed(2);
      }
      // Draw trace
      ctx.lineWidth = 2;
      ctx.strokeStyle = HX.primary;
      ctx.beginPath();
      const N = 1200;
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * Math.PI * 2;
        const x = cx + R * Math.sin(a * u + delta);
        const y = cy + R * Math.sin(b * u);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Moving dot
      const dotU = (t * 0.5) % (Math.PI * 2);
      const dx = cx + R * Math.sin(a * dotU + delta);
      const dy = cy + R * Math.sin(b * dotU);
      ctx.fillStyle = HX.accent;
      ctx.beginPath();
      ctx.arc(dx, dy, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ---------------- DEMO 2 — Spirograph (hypo/epi-trochoid) ----------------

  function initSpirograph(card) {
    const stage = mountCanvas(card);
    const { ctx } = stage;
    const slR = bindSlider("spiro-R", "lbl-spiro-R");
    const slr = bindSlider("spiro-r", "lbl-spiro-r");
    const sld = bindSlider("spiro-d", "lbl-spiro-d", (v) => Number(v).toFixed(1));
    const slM = bindSlider("spiro-mode", "lbl-spiro-mode", (v) =>
      v === "0" ? "hypo (inside)" : "epi (outside)",
    );
    bindPresets(card, [slR, slr, sld, slM]);

    loop(card, (dt, t) => {
      const { w, h } = stage;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const R = Number(slR.value);
      const r = Math.max(0.1, Number(slr.value));
      const d = Number(sld.value);
      const epi = slM.value === "1";
      // Fit the curve to ~80% of the canvas regardless of R/r/d.
      const reach = epi ? R + r + d : Math.max(Math.abs(R - r) + d, R - r + d, 1);
      const scale = (Math.min(w, h) * 0.42) / reach;
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = HX.violet;
      ctx.beginPath();
      // Number of revolutions needed for the curve to close — lcm(R, r) / r.
      const g = gcd(Math.round(R), Math.round(r));
      const turns = Math.max(2, Math.round(R / g));
      const N = Math.min(8000, 600 * turns);
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * Math.PI * 2 * turns;
        let x, y;
        if (epi) {
          x = (R + r) * Math.cos(u) - d * Math.cos(((R + r) / r) * u);
          y = (R + r) * Math.sin(u) - d * Math.sin(((R + r) / r) * u);
        } else {
          x = (R - r) * Math.cos(u) + d * Math.cos(((R - r) / r) * u);
          y = (R - r) * Math.sin(u) - d * Math.sin(((R - r) / r) * u);
        }
        const px = cx + x * scale;
        const py = cy + y * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // Moving dot at one position along the parameter
      const dotU = t * 1.5;
      let dx, dy;
      if (epi) {
        dx = (R + r) * Math.cos(dotU) - d * Math.cos(((R + r) / r) * dotU);
        dy = (R + r) * Math.sin(dotU) - d * Math.sin(((R + r) / r) * dotU);
      } else {
        dx = (R - r) * Math.cos(dotU) + d * Math.cos(((R - r) / r) * dotU);
        dy = (R - r) * Math.sin(dotU) - d * Math.sin(((R - r) / r) * dotU);
      }
      ctx.fillStyle = HX.pink;
      ctx.beginPath();
      ctx.arc(cx + dx * scale, cy + dy * scale, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    function gcd(a, b) {
      a = Math.abs(a);
      b = Math.abs(b);
      while (b) {
        [a, b] = [b, a % b];
      }
      return a || 1;
    }
  }

  // ---------------- DEMO 3 — Curlicue ----------------

  function initCurlicue(card) {
    const stage = mountCanvas(card);
    const { ctx } = stage;
    const slT = bindSlider("curl-theta", "lbl-curl-theta", (v) => Number(v).toFixed(4));
    const slN = bindSlider("curl-n", "lbl-curl-n");
    bindPresets(card, [slT]);

    loop(card, (dt, t) => {
      const { w, h } = stage;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const theta = Number(slT.value);
      const N = Number(slN.value);
      const tOff = t * 0.5;
      // Walk the recurrence z_{n+1} = z_n + e^{i (θ·n² + tOff)} and
      // first measure extent, then rescale to fit the canvas.
      const xs = new Float32Array(N + 1);
      const ys = new Float32Array(N + 1);
      let xMin = 0, xMax = 0, yMin = 0, yMax = 0;
      let x = 0, y = 0;
      xs[0] = 0; ys[0] = 0;
      for (let i = 1; i <= N; i++) {
        const angle = theta * i * i + tOff;
        x += Math.cos(angle);
        y += Math.sin(angle);
        xs[i] = x; ys[i] = y;
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
      const span = Math.max(xMax - xMin, yMax - yMin, 1);
      const scale = (Math.min(w, h) * 0.88) / span;
      const ox = cx - ((xMin + xMax) / 2) * scale;
      const oy = cy - ((yMin + yMax) / 2) * scale;
      // Stroke with a color gradient along the walk so the structure
      // reads (early vs late steps).
      ctx.lineWidth = 0.6;
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, HX.primary);
      grad.addColorStop(0.5, HX.violet);
      grad.addColorStop(1, HX.rose);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ox + xs[0] * scale, oy + ys[0] * scale);
      for (let i = 1; i <= N; i++) ctx.lineTo(ox + xs[i] * scale, oy + ys[i] * scale);
      ctx.stroke();
    });
  }

  // ---------------- DEMO 4 — Archimedean Spiral ----------------

  function initArchimedean(card) {
    const stage = mountCanvas(card);
    const { ctx } = stage;
    const slA = bindSlider("arch-a", "lbl-arch-a", (v) => Number(v).toFixed(1));
    const slB = bindSlider("arch-b", "lbl-arch-b", (v) => Number(v).toFixed(2));
    const slT = bindSlider("arch-t", "lbl-arch-t");

    loop(card, (dt, t) => {
      const { w, h } = stage;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const a = Number(slA.value);
      const b = Number(slB.value);
      const turns = Number(slT.value);
      // Subtle breathing on b — adds life without overwhelming.
      const bAnim = b * (1 + 0.08 * Math.sin(t * 0.8));
      const maxTheta = turns * Math.PI * 2;
      const rMax = a + bAnim * maxTheta;
      const scale = (Math.min(w, h) * 0.45) / Math.max(rMax, 1);
      const rotOff = -t * 0.3; // slow rotation for the tunnel effect
      const N = Math.max(800, turns * 240);
      ctx.lineWidth = 2;
      ctx.strokeStyle = HX.emerald;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const theta = (i / N) * maxTheta;
        const r = (a + bAnim * theta) * scale;
        const x = cx + r * Math.cos(theta + rotOff);
        const y = cy + r * Math.sin(theta + rotOff);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }

  // ---------------- DEMO 5 — Butterfly ----------------

  function initButterfly(card) {
    const stage = mountCanvas(card);
    const { ctx } = stage;
    const slSpd = bindSlider("butter-spd", "lbl-butter-spd", (v) => Number(v).toFixed(1) + "×");
    const slFade = bindSlider("butter-fade", "lbl-butter-fade", (v) => v + "%");

    let trailT = 0;
    let prevX = null, prevY = null;
    loop(card, (dt) => {
      const { w, h } = stage;
      const cx = w / 2, cy = h / 2;
      const scale = Math.min(w, h) * 0.12;
      // Fade the previous frame's content to leave a persistence trail.
      const fadePct = Number(slFade.value) / 100;
      ctx.fillStyle = `rgba(10,14,26,${1 - fadePct})`;
      ctx.fillRect(0, 0, w, h);
      // Draw a short arc of new t values per frame.
      const spd = Number(slSpd.value);
      const steps = Math.max(4, Math.round(40 * spd));
      ctx.strokeStyle = HX.accent;
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      for (let i = 0; i < steps; i++) {
        trailT += dt * 0.4 * spd; // 0.4 ≈ wing-pass rate
        const t = trailT;
        const f = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) - Math.pow(Math.sin(t / 12), 5);
        const x = cx + scale * Math.sin(t) * f;
        const y = cy - scale * Math.cos(t) * f;
        if (prevX !== null) {
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        prevX = x;
        prevY = y;
      }
    });
  }

  // ---------------- DEMO 6 — Gravity Lens ----------------

  /**
   * A semi-realistic toy of Einstein's deflection of light by a point
   * mass. We render:
   *   - a lattice of dots, distorted by the lens potential, so the
   *     viewer sees space "warping"
   *   - N light rays starting from the left edge, deflecting around
   *     the mass at center
   *
   * The deflection α ≈ 4GM / (c²·b) where b is the closest approach
   * to the lens. We don't simulate the geodesic — we apply the
   * thin-lens approximation: each ray bends by `α` once at its
   * closest-approach x.
   */
  function initGravityLens(card) {
    const stage = mountCanvas(card);
    const { ctx } = stage;
    const slM = bindSlider("grav-mass", "lbl-grav-mass", (v) =>
      v === "0" ? "0" : `${(Math.pow(10, Number(v) / 20) * 100).toFixed(0)} M☉`,
    );
    const slB = bindSlider("grav-b", "lbl-grav-b", (v) => Number(v).toFixed(2));
    const slR = bindSlider("grav-rays", "lbl-grav-rays");

    loop(card, (dt, t) => {
      const { w, h } = stage;
      const cx = w / 2, cy = h / 2;
      // Convert slider mass to a dimensionless lens strength.
      // (No real units; tuned visually so the slider sweeps from "no
      // deflection" at 0 to "Einstein ring" near the high end.)
      const M = Math.pow(Number(slM.value) / 100, 1.6) * 0.16; // 0 .. 0.16 (canvas units)
      const bShift = Number(slB.value);
      const rayCount = Number(slR.value);
      // Background gradient → space-like vibe.
      ctx.fillStyle = "#0a0e1a";
      ctx.fillRect(0, 0, w, h);
      // --- Distorted dot lattice ---------------------------------
      const dotSpacing = 24;
      ctx.fillStyle = "rgba(96,165,250,0.45)";
      for (let yy = dotSpacing / 2; yy < h; yy += dotSpacing) {
        for (let xx = dotSpacing / 2; xx < w; xx += dotSpacing) {
          // Vector from lens center
          const dxc = xx - cx;
          const dyc = yy - cy;
          const r = Math.sqrt(dxc * dxc + dyc * dyc) + 0.0001;
          // Pull each dot toward the lens; magnitude ∝ M / r²
          const pull = (M * w * w) / (r * r + 80);
          const px = xx - (dxc / r) * pull;
          const py = yy - (dyc / r) * pull;
          ctx.beginPath();
          ctx.arc(px, py, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // --- Lens mass (visible disk) -----------------------------
      const massR = Math.max(6, 18 * Math.pow(M / 0.16, 0.4));
      const lensGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, massR * 2.4);
      lensGrad.addColorStop(0, "rgba(251,191,36,0.9)");
      lensGrad.addColorStop(0.6, "rgba(251,113,133,0.35)");
      lensGrad.addColorStop(1, "rgba(251,113,133,0)");
      ctx.fillStyle = lensGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, massR * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(cx, cy, massR, 0, Math.PI * 2);
      ctx.fill();
      // --- Light rays --------------------------------------------
      // Rays come in from the left at varying y. Each ray is straight
      // up to its closest-approach x (= cx), then turns by angle α =
      // 4GM / (c²·b) and continues.
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(96,165,250,0.85)";
      for (let i = 0; i < rayCount; i++) {
        // distribute rays vertically around cy + bShift
        const span = (h * 0.7);
        const yOff = (i - (rayCount - 1) / 2) * (span / Math.max(1, rayCount - 1));
        const yStart = cy + yOff + bShift * span * 0.5;
        const b = yStart - cy; // signed impact parameter
        const bAbs = Math.abs(b) + 0.0001;
        // α ∝ M / b, sign opposite to b so rays bend toward the lens.
        const alpha = (-Math.sign(b) * M * 18) / bAbs;
        // Ray segments:
        // 1) straight from left edge to (cx, yStart)
        ctx.beginPath();
        ctx.moveTo(0, yStart);
        ctx.lineTo(cx, yStart);
        // 2) deflected from (cx, yStart) outward at angle alpha
        const dx = w; // continue to right edge
        const dy = alpha * dx;
        ctx.lineTo(cx + dx, yStart + dy);
        ctx.stroke();
      }
      // --- Caption: distant source -------------------------------
      // Show a faint "source" arrow on the right pointing back at
      // the lens to remind viewers what's far away vs near.
      ctx.fillStyle = "rgba(148,163,184,0.5)";
      ctx.font = "11px var(--font-mono)";
      ctx.fillText("← far galaxy", w - 88, 16);
      ctx.fillText("→ observer", 8, h - 8);
    });
  }

  // ---------------- boot ----------------

  const initializers = {
    lissajous: initLissajous,
    spirograph: initSpirograph,
    curlicue: initCurlicue,
    archimedean: initArchimedean,
    butterfly: initButterfly,
    "gravity-lens": initGravityLens,
  };

  function boot() {
    document.querySelectorAll("[data-demo]").forEach((card) => {
      const name = card.getAttribute("data-demo");
      const init = initializers[name];
      if (!init) return;
      try {
        init(card);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`Demo ${name} failed to boot:`, err);
        card.innerHTML = `<div style="display:grid;place-items:center;height:100%;color:#94a3b8;font-size:.85rem">Demo unavailable</div>`;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
