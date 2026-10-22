import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Float32BufferAttribute, Group, Mesh, PerspectiveCamera, PlaneGeometry,
  Points, PointsMaterial, Scene, ShaderMaterial, Sprite, SpriteMaterial, Vector3, WebGLRenderer,
} from "three";

import { CORE, FRAG, TIP, VERT } from "../burst";

gsap.registerPlugin(ScrollTrigger);

/** Real project data the 3D scene visualises. Every field is optional: missing data renders as a short resting petal. */
export interface FxData {
  /** pool balance as a fraction of (pool + vouchers held), 0..1 */
  poolFraction?: number;
  /** latest forecast reading / on-chain forecast threshold (can exceed 1) */
  forecastRatio?: number;
  /** latest gauge reading / on-chain gauge threshold (can exceed 1) */
  gaugeRatio?: number;
}
export interface Fx {
  stop(): void;
  update(d: FxData): void;
}

interface Petal {
  mesh: Mesh;
  angle: number;
  base: number; // resting length
  gain: number; // extra length at ratio 1
  metric: "forecast" | "gauge" | "pool" | "none";
  width: number;
  phase: number;
}

/**
 * Scroll-driven effects for the landing page.
 * 3D (Three.js): a soft glowing burst of petals. Three pairs of large petals are the system's live signals: forecast
 * (upper right), gauge (left) and pool (lower); each lengthens and brightens as its real value approaches its on-chain
 * threshold. Thin spikes are decoration. GSAP ScrollTrigger: fragmenting type, pinned "how it works", scroll-speed
 * marquee, horizontal highlights, timeline, looping demo. Everything degrades: no WebGL => animations only.
 */
export function startFx(root: HTMLElement): Fx {
  const cleanups: (() => void)[] = [];
  root.classList.add("fx");
  cleanups.push(() => root.classList.remove("fx"));

  // ---------------- 3D ----------------
  const canvas = root.querySelector<HTMLCanvasElement>("#lp-gl")!;
  const state = { p: 0, mx: 0, my: 0, step: 0 };
  const target = { pool: 0, f: 0, g: 0 };
  const view = { pool: 0, f: 0, g: 0 };
  let update: (d: FxData) => void = () => {};
  try {
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.1, 50);
    camera.position.set(0, 0, 8);
    const group = new Group();
    scene.add(group);

    const geo = new PlaneGeometry(1, 1, 1, 1);
    geo.translate(0.5, 0, 0); // base of the petal at the origin, pointing along +x
    const mats: ShaderMaterial[] = [];
    const mkMat = (opacity: number, soft: number) => {
      const m = new ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending,
        uniforms: { uCore: { value: CORE }, uTip: { value: TIP }, uOpacity: { value: opacity }, uGlow: { value: 0 }, uSoft: { value: soft } },
      });
      mats.push(m);
      return m;
    };

    const deg = (d: number) => (d * Math.PI) / 180;
    const petals: Petal[] = [];
    const big: [number, Petal["metric"]][] = [[58, "forecast"], [36, "forecast"], [172, "gauge"], [190, "gauge"], [-80, "pool"], [-58, "pool"]];
    big.forEach(([a, metric], i) => {
      const mesh = new Mesh(geo, mkMat(0.72, 0.95));
      mesh.rotation.z = deg(a);
      group.add(mesh);
      petals.push({ mesh, angle: deg(a), base: 1.25, gain: 1.6, metric, width: 0.78, phase: i });
    });
    // Thin decorative spikes with fixed lengths.
    for (let i = 0; i < 22; i++) {
      const mesh = new Mesh(geo, mkMat(0.3, 0.5));
      const a = Math.random() * Math.PI * 2;
      mesh.rotation.z = a;
      group.add(mesh);
      petals.push({ mesh, angle: a, base: 0.7 + Math.random() * 1.1, gain: 0, metric: "none", width: 0.012 + Math.random() * 0.03, phase: Math.random() * 6 });
    }

    // Warm glow at the centre and drifting dust.
    const gc = document.createElement("canvas");
    gc.width = gc.height = 256;
    const g2 = gc.getContext("2d")!;
    const grad = g2.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(245,158,91,.3)");
    grad.addColorStop(0.4, "rgba(245,158,91,.12)");
    grad.addColorStop(1, "rgba(245,158,91,0)");
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 256, 256);
    const glowTex = new CanvasTexture(gc);
    const glow = new Sprite(new SpriteMaterial({ map: glowTex, blending: AdditiveBlending, transparent: true, depthWrite: false }));
    glow.scale.setScalar(4);
    glow.position.z = -0.5;
    group.add(glow);

    const ND = 260;
    const dpos = new Float32Array(ND * 3);
    for (let i = 0; i < ND; i++) new Vector3().randomDirection().multiplyScalar(3 + Math.random() * 3).toArray(dpos, i * 3);
    const dGeo = new BufferGeometry();
    dGeo.setAttribute("position", new Float32BufferAttribute(dpos, 3));
    const dust = new Points(dGeo, new PointsMaterial({ color: 0x9fe8b8, size: 0.028, transparent: true, opacity: 0.55 }));
    group.add(dust);

    const size = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      group.userData.baseX = w > 900 ? 2.1 : 0;
      group.userData.fit = w > 900 ? 1.3 : 0.9;
      camera.updateProjectionMatrix();
    };
    size();
    window.addEventListener("resize", size);
    const onMove = (e: PointerEvent) => {
      state.mx = e.clientX / window.innerWidth - 0.5;
      state.my = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    const t0 = performance.now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = (performance.now() - t0) / 1000;
      view.pool += (target.pool - view.pool) * 0.04;
      view.f += (target.f - view.f) * 0.04;
      view.g += (target.g - view.g) * 0.04;
      for (const p of petals) {
        const ratio = p.metric === "forecast" ? view.f : p.metric === "gauge" ? view.g : p.metric === "pool" ? view.pool : 0;
        const breathe = 1 + 0.05 * Math.sin(t * 1.4 + p.phase);
        const len = (p.base + p.gain * Math.min(1.3, ratio)) * breathe;
        p.mesh.scale.set(len, p.width * (p.metric === "none" ? 1 : 0.8 + 0.4 * Math.min(1, ratio)), 1);
        p.mesh.rotation.z = p.angle + 0.05 * Math.sin(t * 0.7 + p.phase);
        (p.mesh.material as ShaderMaterial).uniforms.uGlow!.value = p.metric !== "none" && ratio >= 1 ? 0.22 + 0.08 * Math.sin(t * 5) : 0;
      }
      const p = state.p;
      const bx = (group.userData.baseX as number) ?? 0;
      const fit = (group.userData.fit as number) ?? 1;
      group.position.x += (bx * (1 - Math.min(1, p * 3.2)) + Math.sin(p * 6.28) * 0.6 - group.position.x) * 0.06;
      group.rotation.z += (t * 0.04 + p * Math.PI * 2 - group.rotation.z) * 0.05;
      group.rotation.y += (state.mx * 0.5 - group.rotation.y) * 0.05;
      group.rotation.x += (-state.my * 0.35 - group.rotation.x) * 0.05;
      const s = fit * (1 + 0.22 * Math.sin(Math.min(1, p) * Math.PI));
      group.scale.setScalar(group.scale.x + (s - group.scale.x) * 0.06);
      dust.rotation.z = t * 0.02;
      renderer.render(scene, camera);
    };
    frame();

    // Public: feed real data in.
    update = (d) => {
      target.pool = d.poolFraction === undefined ? 0 : Math.max(0, Math.min(1, d.poolFraction));
      target.f = d.forecastRatio === undefined ? 0 : Math.max(0, d.forecastRatio);
      target.g = d.gaugeRatio === undefined ? 0 : Math.max(0, d.gaugeRatio);
    };

    cleanups.push(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
      window.removeEventListener("pointermove", onMove);
      geo.dispose();
      dGeo.dispose();
      glowTex.dispose();
      mats.forEach((m) => m.dispose());
      (dust.material as PointsMaterial).dispose();
      glow.material.dispose();
      renderer.dispose();
    });
  } catch {
    canvas.style.display = "none"; // no WebGL: the type and scroll animation still work
  }

  // ---------------- GSAP ----------------
  const ctx = gsap.context(() => {
    const q = <T extends Element>(s: string) => gsap.utils.toArray<T>(s, root);

    ScrollTrigger.create({ trigger: root, start: "top top", end: "bottom bottom", onUpdate: (s) => { state.p = s.progress; } });

    // Intro: hero characters fly in.
    gsap.from(".lp-hero .ch", { yPercent: 120, rotate: () => gsap.utils.random(-25, 25), opacity: 0, duration: 1, ease: "power4.out", stagger: { each: 0.035, from: "random" } });
    gsap.from(".lp-hero .lp-kicker, .lp-hero .lp-sub, .lp-hero .lp-cta, .lp-hero .lp-live", { y: 24, opacity: 0, duration: 0.9, delay: 0.7, stagger: 0.1, ease: "power3.out" });

    // Hero type fragments as you scroll away. The intro animates each .ch (yPercent, rotate, opacity); this scroll
    // animation uses DIFFERENT properties/elements (.ch x, y, skewX and the parent .w rotate + opacity), so the two
    // never overwrite each other's starting values.
    const hero = { trigger: ".lp-hero", start: "top top", end: "bottom 15%", scrub: true };
    q<HTMLElement>(".lp-hero .ch").forEach((ch) => {
      gsap.fromTo(ch, { x: 0, y: 0, skewX: 0 }, { x: gsap.utils.random(-260, 260), y: gsap.utils.random(-320, 120), skewX: gsap.utils.random(-40, 40), ease: "none", immediateRender: false, scrollTrigger: hero });
    });
    q<HTMLElement>(".lp-hero .w").forEach((w) => {
      gsap.fromTo(w, { rotate: 0, opacity: 1 }, { rotate: gsap.utils.random(-30, 30), opacity: 0, ease: "none", immediateRender: false, scrollTrigger: hero });
    });

    // Marquees run faster with scroll speed and flip direction with it.
    q<HTMLElement>(".lp-track").forEach((track) => {
      const dir = Number(track.dataset.dir ?? -1);
      const tw = gsap.to(track, { xPercent: dir < 0 ? -50 : 0, startAt: { xPercent: dir < 0 ? 0 : -50 }, duration: 24, ease: "none", repeat: -1 });
      ScrollTrigger.create({ trigger: track, start: "top bottom", end: "bottom top", onUpdate: (self) => {
        tw.timeScale(gsap.utils.clamp(0.4, 6, 1 + Math.abs(self.getVelocity()) / 350) * (self.direction < 0 ? -1 : 1));
      } });
    });

    // How it works: pinned, scrubbed through four steps, with the big number and a progress bar.
    const steps = q<HTMLElement>(".how-steps .step");
    const n = root.querySelector<HTMLElement>("#how-n");
    gsap.set(steps, { autoAlpha: 0, y: 60 });
    gsap.set(steps[0]!, { autoAlpha: 1, y: 0 });
    const tl = gsap.timeline({ scrollTrigger: { trigger: ".lp-how", start: "top top", end: `+=${steps.length * 90}%`, pin: ".how-pin", scrub: 0.6, onUpdate: (s) => {
      const i = Math.min(steps.length - 1, Math.floor(s.progress * steps.length + 0.25));
      if (i !== state.step) { state.step = i; if (n) n.textContent = String(i + 1).padStart(2, "0"); }
    } } });
    tl.fromTo(".how-bar i", { scaleX: 0 }, { scaleX: 1, ease: "none", duration: steps.length }, 0);
    steps.forEach((s, i) => {
      if (i === 0) return;
      tl.to(steps[i - 1]!, { autoAlpha: 0, y: -60, duration: 0.4 }, i - 0.4);
      tl.to(s, { autoAlpha: 1, y: 0, duration: 0.4 }, i - 0.1);
    });

    // Looping product demo.
    const scenes = q<HTMLElement>(".scene");
    gsap.set(scenes, { autoAlpha: 0, y: 30 });
    const loop = gsap.timeline({ repeat: -1 });
    scenes.forEach((s) => {
      loop.to(s, { autoAlpha: 1, y: 0, duration: 0.5, ease: "power3.out" })
        .to(s, { autoAlpha: 0, y: -30, duration: 0.4, ease: "power2.in" }, "+=1.6");
    });
    ScrollTrigger.create({ trigger: ".lp-demo", start: "top bottom", end: "bottom top", onToggle: (s) => (s.isActive ? loop.play() : loop.pause()) });
    gsap.from(".lp-demo .ch", { yPercent: 100, opacity: 0, stagger: 0.02, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: ".lp-demo", start: "top 70%" } });

    // Images: reveal with a wipe, and drift inside their frame as you scroll (parallax).
    q<HTMLElement>(".duo").forEach((f, i) => {
      const img = f.querySelector("img");
      gsap.from(f, { clipPath: "inset(100% 0 0 0)", duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: f, start: "top 88%" } });
      if (img) gsap.fromTo(img, { yPercent: -5, scale: 1.12 }, { yPercent: 5, scale: 1.12, ease: "none", immediateRender: false, scrollTrigger: { trigger: f, start: "top bottom", end: "bottom top", scrub: true } });
      if (f.classList.contains("a2")) gsap.fromTo(f, { y: 50 }, { y: -50, ease: "none", immediateRender: false, scrollTrigger: { trigger: ".why-art", start: "top bottom", end: "bottom top", scrub: true } });
      void i;
    });

    // Benefits: wipe in each row.
    q<HTMLElement>(".benefit").forEach((b) => {
      gsap.from(b, { clipPath: "inset(0 100% 0 0)", opacity: 0.2, duration: 1, ease: "power3.out", scrollTrigger: { trigger: b, start: "top 85%" } });
    });

    // Highlights: horizontal scroll driven by vertical scroll.
    const track = root.querySelector<HTMLElement>("#lp-stats");
    if (track && window.innerWidth > 800) {
      ScrollTrigger.create({ trigger: ".lp-high", start: "top top", end: () => `+=${Math.max(300, track.scrollWidth - window.innerWidth + 400)}`, pin: true, scrub: true,
        onUpdate: (s) => { gsap.set(track, { x: -(track.scrollWidth - window.innerWidth + 96) * s.progress }); }, invalidateOnRefresh: true });
    }

    // Timeline line draws with scroll; items fade in.
    gsap.fromTo(".road-line i", { scaleY: 0 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: ".road-wrap", start: "top 70%", end: "bottom 70%", scrub: true } });
    q<HTMLElement>(".road-item").forEach((r) => gsap.from(r, { x: -40, opacity: 0, duration: 0.8, ease: "power3.out", scrollTrigger: { trigger: r, start: "top 85%" } }));

    // Dim the 3D scene behind text-heavy sections.
    q<HTMLElement>(".dim").forEach((sec) => {
      ScrollTrigger.create({ trigger: sec, start: "top 60%", end: "bottom 40%", onToggle: (s) => gsap.to(canvas, { opacity: s.isActive ? 0.18 : 1, duration: 0.6 }) });
    });

    // Footer wordmark rises.
    gsap.from(".foot-word .ch", { yPercent: 110, opacity: 0, stagger: 0.04, duration: 1, ease: "power4.out", scrollTrigger: { trigger: ".foot-word", start: "top 95%" } });
  }, root);
  cleanups.push(() => ctx.revert());

  const refresh = () => ScrollTrigger.refresh();
  window.addEventListener("load", refresh);
  cleanups.push(() => window.removeEventListener("load", refresh));

  return {
    stop: () => {
      cleanups.reverse().forEach((f) => {
        try {
          f();
        } catch {
          /* ignore */
        }
      });
    },
    update: (d) => update(d),
  };
}
