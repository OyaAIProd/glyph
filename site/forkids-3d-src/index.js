/**
 * Joy of Math forkids.html §3.5 — three.js wow demos.
 *
 * Two demos, each mounted into a <div class="wow-card__canvas"> the
 * static HTML already laid out:
 *
 *   1. Platonic solids carousel — 5 spinning regular polyhedra
 *      ("Plato thought these were the building blocks of the universe.
 *       Mathematicians later proved there are EXACTLY 5.")
 *   2. Rolling-wave sine surface — concentric ripples on a 60×60 grid
 *      driven by z = sin(r − t) · e^(−r/10).
 *
 * Both demos pause when off-screen or when the tab is hidden — saves the
 * school iPad's battery. Both error out gracefully into the page's
 * built-in <img> fallback (the static HTML already has `.wow-fallback`
 * elements waiting; we just flip `data-fallback="true"` on the card).
 *
 * Bundled with esbuild from this source + tree-shaken three.js imports.
 * The output ships as a single ES module at site/forkids-3d.js, loaded
 * by the IntersectionObserver in forkids.html when §3.5 scrolls into
 * view.
 */

import {
  AmbientLight,
  AxesHelper,
  BoxGeometry,
  Color,
  DirectionalLight,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  TetrahedronGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/** E4 playground palette — five categorical colors. Mirrors the page CSS. */
const PALETTE = ["#3b82f6", "#facc15", "#f97316", "#10b981", "#a78bfa"];

/** Animation loops register here so we can pause everything in one place. */
const loops = new Set();

/** When false, all registered loops skip their per-frame work. */
let runningGlobal = true;

document.addEventListener("visibilitychange", () => {
  runningGlobal = !document.hidden;
});

/**
 * Mount a renderer + camera + controls into a container, returning the
 * objects + an animate() helper the caller drives. Sizes the renderer to
 * the container's bounding box and re-fits on ResizeObserver events.
 */
function mountStage(container) {
  const scene = new Scene();
  scene.background = new Color(0x0f172a);

  const camera = new PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 3.5, 9);

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x0f172a, 1);
  container.appendChild(renderer.domElement);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;

  function fit() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(container);

  // Only animate while the card itself is on-screen — saves battery once
  // the kid scrolls past §3.5 to §4+.
  let onScreen = true;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) onScreen = e.isIntersecting;
    },
    { threshold: 0.05 },
  );
  io.observe(container);

  let lastT = performance.now();
  function loopWrap(perFrame) {
    function tick(t) {
      const dt = Math.min(0.05, (t - lastT) / 1000); // clamp big gaps (tab restore)
      lastT = t;
      if (runningGlobal && onScreen) {
        perFrame(dt);
        controls.update();
        renderer.render(scene, camera);
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  return { scene, camera, renderer, controls, animate: loopWrap };
}

// ---------------------------------------------------------------------------
// Demo A — Platonic Solids Carousel
// ---------------------------------------------------------------------------

/**
 * Lay out five Platonic solids on a horizontal circle and spin each in
 * place while the whole carousel orbits. Click handler raycasts to find
 * the tapped solid and dollies the camera toward it.
 */
function platonicCarousel(container) {
  const { scene, camera, animate, renderer, controls } = mountStage(container);

  // Soft chalk-style lighting — directional from upper-right, ambient
  // fill from below so the underside isn't black.
  const ambient = new AmbientLight(0xf8f8ff, 0.55);
  scene.add(ambient);
  const dir = new DirectionalLight(0xffffff, 0.85);
  dir.position.set(4, 6, 5);
  scene.add(dir);

  // Each solid lives on its own pivot group so we can spin it around its
  // own local axis while the parent group orbits the camera horizontally.
  const carousel = new Group();
  scene.add(carousel);

  const geomFactories = [
    () => new TetrahedronGeometry(0.7),
    () => new BoxGeometry(1, 1, 1),
    () => new OctahedronGeometry(0.8),
    () => new DodecahedronGeometry(0.78),
    () => new IcosahedronGeometry(0.82),
  ];
  const labels = ["Tetrahedron", "Cube", "Octahedron", "Dodecahedron", "Icosahedron"];

  const solids = [];
  const N = 5;
  const radius = 3.0;
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    const pivot = new Group();
    pivot.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    const mat = new MeshStandardMaterial({
      color: new Color(PALETTE[i % PALETTE.length]),
      flatShading: true,
      roughness: 0.55,
      metalness: 0.05,
      transparent: true,
      opacity: 1,
    });
    const mesh = new Mesh(geomFactories[i](), mat);
    pivot.add(mesh);
    carousel.add(pivot);
    solids.push({ pivot, mesh, mat, label: labels[i], spin: 0.4 + i * 0.07 });
  }

  // Click → focus. The selected solid stays at full opacity; the others
  // fade to 0.2 so the kid's attention lands. Subsequent click resets.
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let focusedIdx = -1;
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(
      solids.map((s) => s.mesh),
      false,
    );
    if (hits.length === 0) {
      focusedIdx = -1;
    } else {
      const hit = hits[0].object;
      const idx = solids.findIndex((s) => s.mesh === hit);
      focusedIdx = focusedIdx === idx ? -1 : idx;
    }
  });

  let carouselAngle = 0;
  animate((dt) => {
    carouselAngle += dt * 0.25;
    carousel.rotation.y = carouselAngle;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      s.mesh.rotation.x += dt * s.spin;
      s.mesh.rotation.y += dt * s.spin * 0.7;
      // Lerp opacity toward focus state. Smooth (≈250ms half-life) lerp.
      const target = focusedIdx === -1 || focusedIdx === i ? 1 : 0.2;
      s.mat.opacity += (target - s.mat.opacity) * Math.min(1, dt * 6);
    }
  });
}

// ---------------------------------------------------------------------------
// Demo B — Rolling Wave Sine Surface
// ---------------------------------------------------------------------------

/**
 * 60×60 vertex grid; each frame we update z = sin(r − t) · e^(−r/10).
 * Renders as a wireframe sitting on top of a soft solid mesh so the
 * structure is visible without losing the smooth "water" look.
 */
function rollingWaveSurface(container) {
  const { scene, camera, animate } = mountStage(container);
  camera.position.set(0, 5, 11);

  // The Y-up world axis convention. Rotate the plane so its z becomes
  // world-y (height), which matches the "ripples rising out of water"
  // mental model.
  const N = 60;
  const SIZE = 12;
  const planeGeom = new PlaneGeometry(SIZE, SIZE, N, N);
  planeGeom.rotateX(-Math.PI / 2);

  // Solid base — flat-shaded, low-opacity so the wireframe reads.
  const solidMat = new MeshStandardMaterial({
    color: new Color(0x1e3a8a),
    flatShading: false,
    roughness: 0.75,
    metalness: 0.05,
    transparent: true,
    opacity: 0.55,
    side: 2, // DoubleSide
  });
  const solid = new Mesh(planeGeom, solidMat);
  scene.add(solid);

  // Wireframe overlay — same geometry, line material, brighter color.
  const wireMat = new MeshBasicMaterial({
    color: new Color(0x60a5fa),
    wireframe: true,
    transparent: true,
    opacity: 0.85,
  });
  const wire = new Mesh(planeGeom, wireMat);
  scene.add(wire);

  // Soft chalk lighting (directional + ambient) so the solid mesh has shape.
  const ambient = new AmbientLight(0xf8f8ff, 0.6);
  scene.add(ambient);
  const dir = new DirectionalLight(0xffffff, 0.75);
  dir.position.set(5, 8, 4);
  scene.add(dir);

  // Time accumulator drives the t in sin(r − t).
  const positionAttr = planeGeom.attributes.position;
  const pCount = positionAttr.count;
  const originalRadii = new Float32Array(pCount);
  for (let i = 0; i < pCount; i++) {
    const x = positionAttr.getX(i);
    const z = positionAttr.getZ(i);
    originalRadii[i] = Math.hypot(x, z);
  }

  let t = 0;
  animate((dt) => {
    t += dt * 1.3;
    for (let i = 0; i < pCount; i++) {
      const r = originalRadii[i];
      const y = Math.sin(r - t) * Math.exp(-r / 8) * 1.1;
      positionAttr.setY(i, y);
    }
    positionAttr.needsUpdate = true;
    planeGeom.computeVertexNormals();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/**
 * Mount both demos into their canvas containers. Any failure here flips
 * the card's `data-fallback="true"` so the page's static <img> takes over.
 */
function boot() {
  const cards = document.querySelectorAll('[data-forkids-section="3d"] .wow-card');
  // `for...of` over the NodeList (biome's noForEach rule prefers this
  // shape — fewer callback frames, easier to step through in devtools).
  for (const card of cards) {
    const canvas = card.querySelector(".wow-card__canvas");
    if (!canvas) continue;
    const which = card.getAttribute("data-demo");
    try {
      if (which === "platonics") platonicCarousel(canvas);
      else if (which === "rolling-wave") rollingWaveSurface(canvas);
      else card.setAttribute("data-fallback", "true");
    } catch (err) {
      // Any boot-time error → fall back to the static SVG poster the page
      // already has waiting in the DOM. Keep the rest of the page healthy.
      // eslint-disable-next-line no-console
      console.warn("forkids-3d demo failed:", which, err);
      card.setAttribute("data-fallback", "true");
    }
  }
}

// The loader script in forkids.html injects this module after IO triggers.
// We boot immediately on parse — no DOMContentLoaded wait needed since the
// loader fires after the section is in viewport (= after parse).
boot();
