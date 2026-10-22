import {
  AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, Mesh, PerspectiveCamera, PlaneGeometry, Points, PointsMaterial,
  Scene, ShaderMaterial, Vector3, WebGLRenderer,
} from "three";
import { CORE, FRAG, TIP, VERT } from "./burst";

/**
 * Ambient background for the app pages: the same dark scene as the landing page (a slowly turning burst of soft petals
 * and drifting dust), fixed behind the content. Decorative only: it shows no data. Returns a cleanup function.
 * With reduced motion or no WebGL it does nothing and the CSS gradient fallback remains.
 */
export function startAmbient(): () => void {
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const canvas = document.createElement("canvas");
  canvas.id = "ambient";
  canvas.setAttribute("aria-hidden", "true");
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return () => {}; // no WebGL: the page keeps its CSS gradient background
  }
  document.body.prepend(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.1, 50);
  camera.position.z = 8;
  const group = new Group();
  scene.add(group);

  const geo = new PlaneGeometry(1, 1);
  geo.translate(0.5, 0, 0);
  const mats: ShaderMaterial[] = [];
  const mk = (opacity: number, soft: number) => {
    const m = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uCore: { value: CORE }, uTip: { value: TIP }, uOpacity: { value: opacity }, uGlow: { value: 0 }, uSoft: { value: soft } },
    });
    mats.push(m);
    return m;
  };
  const petals: { m: Mesh; a: number; len: number; w: number; ph: number }[] = [];
  const angles = [58, 36, 172, 190, -80, -58];
  angles.forEach((deg, i) => {
    const m = new Mesh(geo, mk(0.7, 0.95));
    group.add(m);
    petals.push({ m, a: (deg * Math.PI) / 180, len: 1.9, w: 0.7, ph: i });
  });
  for (let i = 0; i < 16; i++) {
    const m = new Mesh(geo, mk(0.28, 0.5));
    group.add(m);
    petals.push({ m, a: Math.random() * Math.PI * 2, len: 0.8 + Math.random() * 1.1, w: 0.012 + Math.random() * 0.03, ph: Math.random() * 6 });
  }
  const ND = 220;
  const dpos = new Float32Array(ND * 3);
  for (let i = 0; i < ND; i++) new Vector3().randomDirection().multiplyScalar(3 + Math.random() * 4).toArray(dpos, i * 3);
  const dGeo = new BufferGeometry();
  dGeo.setAttribute("position", new Float32BufferAttribute(dpos, 3));
  const dust = new Points(dGeo, new PointsMaterial({ color: 0x9fe8b8, size: 0.028, transparent: true, opacity: 0.5 }));
  scene.add(dust);

  const size = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    group.position.set(w > 900 ? 3.2 : 0.8, 0.4, 0);
    group.scale.setScalar(w > 900 ? 1.3 : 0.9);
    camera.updateProjectionMatrix();
  };
  size();
  window.addEventListener("resize", size);

  let raf = 0;
  const t0 = performance.now();
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = (performance.now() - t0) / 1000;
    for (const p of petals) {
      p.m.scale.set(p.len * (1 + 0.05 * Math.sin(t * 1.2 + p.ph)), p.w, 1);
      p.m.rotation.z = p.a + 0.05 * Math.sin(t * 0.6 + p.ph);
    }
    group.rotation.z = t * 0.03;
    dust.rotation.z = t * 0.015;
    renderer.render(scene, camera);
  };
  frame();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", size);
    geo.dispose();
    dGeo.dispose();
    mats.forEach((m) => m.dispose());
    (dust.material as PointsMaterial).dispose();
    renderer.dispose();
    canvas.remove();
  };
}
