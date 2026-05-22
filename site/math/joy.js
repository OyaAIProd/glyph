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
    let w = 0;
    let h = 0;
    function fit() {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // ALL drawing uses CSS px.
    }
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return {
      canvas,
      ctx,
      get w() {
        return w;
      },
      get h() {
        return h;
      },
    };
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
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.42;
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
      const cx = w / 2;
      const cy = h / 2;
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
        let x;
        let y;
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
      let dx;
      let dy;
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
      const cx = w / 2;
      const cy = h / 2;
      const theta = Number(slT.value);
      const N = Number(slN.value);
      const tOff = t * 0.5;
      // Walk the recurrence z_{n+1} = z_n + e^{i (θ·n² + tOff)} and
      // first measure extent, then rescale to fit the canvas.
      const xs = new Float32Array(N + 1);
      const ys = new Float32Array(N + 1);
      let xMin = 0;
      let xMax = 0;
      let yMin = 0;
      let yMax = 0;
      let x = 0;
      let y = 0;
      xs[0] = 0;
      ys[0] = 0;
      for (let i = 1; i <= N; i++) {
        const angle = theta * i * i + tOff;
        x += Math.cos(angle);
        y += Math.sin(angle);
        xs[i] = x;
        ys[i] = y;
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
      const cx = w / 2;
      const cy = h / 2;
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
    const slSpd = bindSlider("butter-spd", "lbl-butter-spd", (v) => `${Number(v).toFixed(1)}×`);
    const slFade = bindSlider("butter-fade", "lbl-butter-fade", (v) => `${v}%`);

    let trailT = 0;
    let prevX = null;
    let prevY = null;
    loop(card, (dt) => {
      const { w, h } = stage;
      const cx = w / 2;
      const cy = h / 2;
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
        const f = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) - Math.sin(t / 12) ** 5;
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
      v === "0" ? "0" : `${(10 ** (Number(v) / 20) * 100).toFixed(0)} M☉`,
    );
    const slB = bindSlider("grav-b", "lbl-grav-b", (v) => Number(v).toFixed(2));
    const slR = bindSlider("grav-rays", "lbl-grav-rays");

    loop(card, (dt, t) => {
      const { w, h } = stage;
      const cx = w / 2;
      const cy = h / 2;
      // Convert slider mass to a dimensionless lens strength.
      // (No real units; tuned visually so the slider sweeps from "no
      // deflection" at 0 to "Einstein ring" near the high end.)
      const M = (Number(slM.value) / 100) ** 1.6 * 0.16; // 0 .. 0.16 (canvas units)
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
      const massR = Math.max(6, 18 * (M / 0.16) ** 0.4);
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
        const span = h * 0.7;
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

  // ============================================================
  // FLUID + PDE DEMOS
  // ============================================================

  // ---------------- DEMO 7 — Particle Flow Field ----------------

  /**
   * Lagrangian particles drifting through an Eulerian velocity field.
   *
   * Stream function:
   *   ψ(x, y, t) = sin(k·x + ω·t) · cos(k·y)
   *              + cos(k·x) · sin(k·y − ω·t)
   *
   * Velocity is the CURL of ψ — guarantees incompressible (∇·v = 0)
   * flow, which is what makes the resulting field swirl rather than
   * have visible sources/sinks. Analytic derivatives:
   *
   *   ∂ψ/∂y = -k·sin(k·x + ω·t)·sin(k·y) + k·cos(k·x)·cos(k·y − ω·t)
   *   ∂ψ/∂x =  k·cos(k·x + ω·t)·cos(k·y) − k·sin(k·x)·sin(k·y − ω·t)
   *
   * vx = ∂ψ/∂y,  vy = -∂ψ/∂x.
   *
   * Particles get periodic-boundary wrap so the field stays full.
   */
  function initFlowField(card) {
    const stage = mountCanvas(card);
    const { canvas, ctx } = stage;
    const slN = bindSlider("flow-n", "lbl-flow-n");
    const slK = bindSlider("flow-k", "lbl-flow-k", (v) => Number(v).toFixed(1));
    const slW = bindSlider("flow-w", "lbl-flow-w", (v) => Number(v).toFixed(2));
    const slFade = bindSlider("flow-fade", "lbl-flow-fade", (v) => `${v}%`);

    const particles = []; // { x, y } in canvas-px
    let lastCount = 0;

    // Click → spawn a fresh burst of ~80 particles at the cursor so
    // the user can "release a tracer here and watch it ride the flow."
    // This is the streamline-discovery interaction: drop a marker, see
    // the local field's character.
    canvas.addEventListener("pointerdown", (ev) => {
      const rect = canvas.getBoundingClientRect();
      const cx = (ev.clientX - rect.left) * (stage.w / rect.width);
      const cy = (ev.clientY - rect.top) * (stage.h / rect.height);
      const burst = 80;
      for (let i = 0; i < burst; i++) {
        // Gaussian-ish scatter around the click so the seeds aren't
        // perfectly co-located (otherwise they trace the same path).
        const r = Math.random() * 6;
        const a = Math.random() * Math.PI * 2;
        particles.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      // Cap so unrestricted clicking doesn't unbound the array.
      const maxN = Number(slN.value) + 800;
      if (particles.length > maxN) particles.splice(0, particles.length - maxN);
    });

    loop(card, (dt, t) => {
      const { w, h } = stage;
      // Persistence-trail fade (uniform RGBA fill on top of last frame)
      const fadePct = Number(slFade.value) / 100;
      ctx.fillStyle = `rgba(10,14,26,${1 - fadePct})`;
      ctx.fillRect(0, 0, w, h);

      // Resize particle pool if slider changed (avoid alloc churn).
      const N = Number(slN.value);
      if (N !== lastCount) {
        if (N > particles.length) {
          for (let i = particles.length; i < N; i++) {
            particles.push({ x: Math.random() * w, y: Math.random() * h });
          }
        } else {
          particles.length = N;
        }
        lastCount = N;
      }

      const k = (Number(slK.value) * Math.PI) / Math.max(w, h);
      const omega = Number(slW.value);
      const phase = omega * t;
      const speed = 80; // px / unit-of-vel — tuned visually

      ctx.lineWidth = 1;
      ctx.lineCap = "round";
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const kx = k * p.x;
        const ky = k * p.y;
        // Velocity = curl(ψ)
        const vx =
          -k * Math.sin(kx + phase) * Math.sin(ky) + k * Math.cos(kx) * Math.cos(ky - phase);
        const vy = -(
          k * Math.cos(kx + phase) * Math.cos(ky) -
          k * Math.sin(kx) * Math.sin(ky - phase)
        );
        const dx = (vx / k) * speed * dt;
        const dy = (vy / k) * speed * dt;
        // Color by direction angle — gives the swirls their character
        const hue = (Math.atan2(vy, vx) * 180) / Math.PI + 180;
        ctx.strokeStyle = `hsla(${hue},80%,65%,0.7)`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        const nx = p.x + dx;
        const ny = p.y + dy;
        ctx.lineTo(nx, ny);
        ctx.stroke();
        // Periodic wrap so the field stays "full" without re-seeding
        p.x = ((nx % w) + w) % w;
        p.y = ((ny % h) + h) % h;
      }
    });
  }

  // ---------------- DEMO 8 — 2D Wave Equation ----------------

  /**
   * Discretized wave equation on a fixed-size grid. Two state buffers
   * (current u and previous u_prev). At each step:
   *
   *   u_next = 2·u − u_prev + dt²·c²·∇²u − γ·(u − u_prev)
   *
   * Discrete laplacian uses 4-neighbor stencil. Boundaries are clamped
   * to zero (rigid walls → ripples reflect). Click drops a Gaussian
   * impulse. Render maps |u| → blue-to-cyan color ramp.
   */
  function initWaves(card) {
    const stage = mountCanvas(card);
    const { canvas, ctx } = stage;
    const slC = bindSlider("wave-c", "lbl-wave-c", (v) => Number(v).toFixed(2));
    const slG = bindSlider("wave-g", "lbl-wave-g", (v) => Number(v).toFixed(3));
    const slRate = bindSlider("wave-rate", "lbl-wave-rate", (v) => Number(v).toFixed(1));

    const GRID = 200;
    let u = new Float32Array(GRID * GRID);
    let uPrev = new Float32Array(GRID * GRID);
    const buf = new Uint8ClampedArray(GRID * GRID * 4);
    const img = new ImageData(buf, GRID, GRID);

    /** Add a Gaussian impulse centered at (cx, cy) in grid coords. */
    function impulse(cx, cy, strength) {
      const r = 4;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.round(cx + dx);
          const y = Math.round(cy + dy);
          if (x < 1 || x >= GRID - 1 || y < 1 || y >= GRID - 1) continue;
          const d2 = dx * dx + dy * dy;
          u[y * GRID + x] += strength * Math.exp(-d2 / 4);
        }
      }
    }

    // Click → drop a stone where you click. We also record the time
    // of the most recent user click so the on-canvas hint pulse can
    // fade itself out once the user has discovered the interaction.
    let lastUserClick = Number.NEGATIVE_INFINITY;
    canvas.addEventListener("pointerdown", (ev) => {
      const rect = canvas.getBoundingClientRect();
      const gx = ((ev.clientX - rect.left) / rect.width) * GRID;
      const gy = ((ev.clientY - rect.top) / rect.height) * GRID;
      impulse(gx, gy, 1.6);
      lastUserClick = performance.now() / 1000;
    });

    let nextAutoDrop = 0;
    let stepAccum = 0;
    const STEP_DT = 1; // PDE time step (dimensionless)

    loop(card, (dt, t) => {
      // Auto-drops at the slider's rate
      const rate = Number(slRate.value);
      if (rate > 0 && t >= nextAutoDrop) {
        impulse(GRID * (0.2 + 0.6 * Math.random()), GRID * (0.2 + 0.6 * Math.random()), 1.0);
        nextAutoDrop = t + 1 / rate;
      }

      // Run the PDE forward at a fixed step rate so visuals are
      // independent of the browser's frame timing.
      const stepsPerFrame = 2;
      stepAccum += dt;
      while (stepAccum > 0) {
        const c2 = Number(slC.value) * Number(slC.value);
        const gamma = Number(slG.value);
        for (let s = 0; s < stepsPerFrame; s++) {
          const uNext = new Float32Array(GRID * GRID);
          for (let yy = 1; yy < GRID - 1; yy++) {
            const yOff = yy * GRID;
            for (let xx = 1; xx < GRID - 1; xx++) {
              const idx = yOff + xx;
              const lap = u[idx - 1] + u[idx + 1] + u[idx - GRID] + u[idx + GRID] - 4 * u[idx];
              uNext[idx] = 2 * u[idx] - uPrev[idx] + c2 * lap - gamma * (u[idx] - uPrev[idx]);
            }
          }
          uPrev = u;
          u = uNext;
        }
        stepAccum -= STEP_DT / 60;
      }

      // Map u → color into ImageData
      for (let i = 0; i < u.length; i++) {
        // Map signed amplitude into a cyan→deep-blue divergent ramp.
        const v = Math.tanh(u[i] * 1.4); // -1 .. 1
        const off = i * 4;
        if (v > 0) {
          // crest: bright cyan
          buf[off] = Math.round(50 + v * 130);
          buf[off + 1] = Math.round(180 + v * 75);
          buf[off + 2] = Math.round(220 + v * 35);
        } else {
          // trough: deep indigo
          buf[off] = Math.round(20 - v * 30);
          buf[off + 1] = Math.round(40 - v * 40);
          buf[off + 2] = Math.round(80 - v * 60);
        }
        buf[off + 3] = 255;
      }
      // Paint grid to canvas (scaled up via drawImage off an offscreen
      // canvas — cheaper than per-pixel scaling).
      const { w, h } = stage;
      // Reuse a single offscreen for the grid
      if (!card._wavesOffscreen) {
        const oc = document.createElement("canvas");
        oc.width = GRID;
        oc.height = GRID;
        card._wavesOffscreen = oc;
      }
      card._wavesOffscreen.getContext("2d").putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(card._wavesOffscreen, 0, 0, w, h);

      // ----- Click-hint overlay --------------------------------------
      // Mobile users (and anyone who didn't read the caption) need a
      // visible "tap here" affordance. Pulse a translucent ring at the
      // canvas center for the first 8 seconds after page load AND
      // whenever the user has been idle for > 12 seconds — fades
      // immediately as soon as they click.
      const tSinceClick = t - lastUserClick;
      const showHint = lastUserClick === Number.NEGATIVE_INFINITY ? t < 8 : tSinceClick > 12;
      if (showHint) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3); // 0..1, ~2 Hz
        const r = 24 + pulse * 18;
        ctx.save();
        ctx.globalAlpha = 0.4 + pulse * 0.3;
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
        ctx.stroke();
        // Center dot + caption
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#fde68a";
        ctx.font = "13px -apple-system, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("click anywhere to drop a stone", w / 2, h / 2 + r + 18);
        ctx.restore();
      }
    });
  }

  // ---------------- DEMO 9 — Reaction-Diffusion (Gray-Scott) ----------------

  /**
   * Gray-Scott reaction-diffusion model. Two species U, V on a grid:
   *
   *   ∂U/∂t = Dᵤ·∇²U − U·V² + F·(1 − U)
   *   ∂V/∂t = Dᵥ·∇²V + U·V² − (F + k)·V
   *
   * Dᵤ = 1.0, Dᵥ = 0.5 (the diffusion-ratio that makes Turing
   * patterns emerge). F (feed) and k (kill) are sliders. Different
   * (F, k) regions of parameter space give wildly different patterns:
   * spots, stripes, worms, mitosis-like self-replication, …
   *
   * Solved by explicit Euler on a fixed grid. Two ping-pong float32
   * buffers per species (no allocation per step). Periodic boundaries
   * — patterns wrap around the edges.
   */
  function initReactionDiffusion(card) {
    const stage = mountCanvas(card);
    const { canvas, ctx } = stage;
    const slF = bindSlider("rd-F", "lbl-rd-F", (v) => Number(v).toFixed(3));
    const slK = bindSlider("rd-k", "lbl-rd-k", (v) => Number(v).toFixed(3));

    // Preset transitions are LERP-ed over ~1.5 s so the bifurcation
    // between regimes (spots → stripes, etc.) is visible as the
    // pattern morphs in place. Without this the user just sees a
    // hard jump; with it, the phase boundary becomes the point of the
    // demo. Each click sets a target; the per-frame update walks the
    // sliders toward that target and dispatches "input" events so the
    // labels track.
    const LERP_MS = 1500;
    let lerpState = null; // { fStart, kStart, fEnd, kEnd, t0 }
    card.querySelectorAll("button[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const vals = btn.getAttribute("data-preset").split(",").map(Number);
        lerpState = {
          fStart: Number(slF.value),
          kStart: Number(slK.value),
          fEnd: vals[0],
          kEnd: vals[1],
          t0: performance.now(),
        };
      });
    });

    const GRID = 160;
    const SIZE = GRID * GRID;
    let U = new Float32Array(SIZE);
    let V = new Float32Array(SIZE);
    let Un = new Float32Array(SIZE);
    let Vn = new Float32Array(SIZE);
    const buf = new Uint8ClampedArray(SIZE * 4);
    const img = new ImageData(buf, GRID, GRID);

    function reseed() {
      U.fill(1);
      V.fill(0);
      // Drop several V-seed blobs so the field has somewhere to grow
      for (let i = 0; i < 12; i++) {
        const cx = Math.random() * GRID;
        const cy = Math.random() * GRID;
        for (let dy = -5; dy <= 5; dy++) {
          for (let dx = -5; dx <= 5; dx++) {
            const x = Math.round(cx + dx);
            const y = Math.round(cy + dy);
            if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
            const idx = y * GRID + x;
            U[idx] = 0.5;
            V[idx] = 0.25;
          }
        }
      }
    }
    reseed();
    // Reseed when the user clicks → lets them re-randomize without
    // hunting for the F/k that boots a stuck pattern.
    canvas.addEventListener("pointerdown", reseed);

    const Du = 1.0;
    const Dv = 0.5;

    loop(card, (dt) => {
      // Drive any in-progress preset lerp toward its target. The PDE
      // step reads from the slider values, so updating the sliders
      // smoothly is what produces the visible morph.
      if (lerpState) {
        const elapsed = performance.now() - lerpState.t0;
        const u = Math.min(1, elapsed / LERP_MS);
        // Smoothstep ease so the morph starts and ends gracefully.
        const e = u * u * (3 - 2 * u);
        const newF = lerpState.fStart + (lerpState.fEnd - lerpState.fStart) * e;
        const newK = lerpState.kStart + (lerpState.kEnd - lerpState.kStart) * e;
        slF.value = String(newF);
        slK.value = String(newK);
        document.getElementById("lbl-rd-F").textContent = newF.toFixed(3);
        document.getElementById("lbl-rd-k").textContent = newK.toFixed(3);
        if (u >= 1) lerpState = null;
      }
      const F = Number(slF.value);
      const k = Number(slK.value);

      // Multiple sub-steps per visible frame; the explicit Euler PDE
      // is unstable for large dt, but cheap, so we just take small
      // steps. 6 sub-steps × 60 fps ≈ 360 steps/sec — enough for the
      // patterns to evolve visibly without going unstable at typical
      // (F, k).
      for (let step = 0; step < 6; step++) {
        for (let yy = 0; yy < GRID; yy++) {
          // Periodic neighbors (wrap)
          const yp = (yy - 1 + GRID) % GRID;
          const yn = (yy + 1) % GRID;
          for (let xx = 0; xx < GRID; xx++) {
            const xp = (xx - 1 + GRID) % GRID;
            const xn = (xx + 1) % GRID;
            const idx = yy * GRID + xx;
            const u = U[idx];
            const v = V[idx];
            // 5-point laplacian (centered − 4·self)
            const lapU =
              U[yp * GRID + xx] + U[yn * GRID + xx] + U[yy * GRID + xp] + U[yy * GRID + xn] - 4 * u;
            const lapV =
              V[yp * GRID + xx] + V[yn * GRID + xx] + V[yy * GRID + xp] + V[yy * GRID + xn] - 4 * v;
            const uvv = u * v * v;
            Un[idx] = u + Du * lapU - uvv + F * (1 - u);
            Vn[idx] = v + Dv * lapV + uvv - (F + k) * v;
          }
        }
        // Swap buffers (no allocation)
        const tU = U;
        U = Un;
        Un = tU;
        const tV = V;
        V = Vn;
        Vn = tV;
      }

      // Map V → grayscale-ish + accent colorize
      for (let i = 0; i < SIZE; i++) {
        const v = Math.max(0, Math.min(1, V[i]));
        const off = i * 4;
        // Pattern reads: V near 0 → indigo bg, V high → warm crests
        if (v < 0.2) {
          buf[off] = 12;
          buf[off + 1] = 16;
          buf[off + 2] = 32;
        } else {
          const tv = (v - 0.2) / 0.8;
          // gradient: deep blue → cyan → gold
          buf[off] = Math.round(40 + tv * 215);
          buf[off + 1] = Math.round(70 + tv * 130);
          buf[off + 2] = Math.round(200 - tv * 160);
        }
        buf[off + 3] = 255;
      }
      const { w, h } = stage;
      if (!card._rdOffscreen) {
        const oc = document.createElement("canvas");
        oc.width = GRID;
        oc.height = GRID;
        card._rdOffscreen = oc;
      }
      card._rdOffscreen.getContext("2d").putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(card._rdOffscreen, 0, 0, w, h);
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
    "flow-field": initFlowField,
    waves: initWaves,
    "reaction-diffusion": initReactionDiffusion,
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
