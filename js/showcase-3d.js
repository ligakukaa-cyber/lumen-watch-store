// Живые 3D-часы по всему сайту. Один WebGL-холст поверх страницы рисует каждую
// «витрину» [data-watch3d] в её прямоугольнике (scissor): один контекст на всю
// страницу — часов может быть сколько угодно, а телефон не задыхается.
//
// Режимы витрины (data-mode):
//   hero      — главная: часы сами приоткрываются и собираются, при прокрутке раскрываются
//   turntable — карточки: медленное вращение, при наведении механизм приоткрывается
//   back      — вид сзади: ротор качается, мосты «дышат» над платиной
import * as THREE from "three";
import { createWatch, studioEnvironment, addStudioLights, waitForDialFont } from "./watch-model.js";
import { clamp01, lerp, smoothstep, fitDistance, heroBreath } from "./mechanics.js";

const REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOUCH = window.matchMedia("(hover: none)").matches;
const HERO_PEAK = 0.62;

export async function mountShowcase() {
  const els = [...document.querySelectorAll("[data-watch3d]")];
  if (!els.length) return;

  const canvas = document.createElement("canvas");
  canvas.className = "showcase-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (err) {
    canvas.remove();
    return; // без WebGL остаются фото — страница не ломается
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setScissorTest(true);
  const env = studioEnvironment(renderer, { bright: true });
  await waitForDialFont();

  const pointer = { x: 0, y: 0 };
  window.addEventListener("pointermove", (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  const views = els.map((el, i) => {
    const v = {
      el, mode: el.dataset.mode || "turntable", phase: i * 1.9, model: null, scene: null,
      camera: new THREE.PerspectiveCamera(28, 1, 0.1, 100), hovering: false, hover: 0, e: 0,
      spin: -0.5 + i * 0.8, inAt: 0,
    };
    const target = el.closest("a.card, .gallery-main, .premium-band") || el;
    target.addEventListener("pointerenter", () => { v.hovering = true; });
    target.addEventListener("pointerleave", () => { v.hovering = false; });
    return v;
  });

  // Модель собирается, когда витрина подъезжает к экрану, — не больше одной за кадр.
  function build(v) {
    v.scene = new THREE.Scene();
    v.scene.environment = env;
    addStudioLights(v.scene);
    v.model = createWatch(renderer, v.el.dataset.variant || "midnight", { dialSize: v.mode === "hero" ? 2048 : 1024 });
    v.model.redrawDial();
    v.scene.add(v.model.group);
  }

  function aim(v, t, aspect) {
    const cam = v.camera;
    let az;
    let el;
    let d;
    if (v.mode === "hero") {
      const k = v.e / HERO_PEAK;
      az = lerp(-0.55, 1.1, smoothstep(0, 1, k)) + pointer.x * 0.12;
      el = 0.2 + 0.1 * k - pointer.y * 0.06;
      d = lerp(fitDistance(5.4, 5.4, cam.fov, aspect, 1.1), fitDistance(7.8, 6.6, cam.fov, aspect, 1.02), k);
    } else if (v.mode === "back") {
      az = Math.PI + 0.35 + (REDUCE ? 0 : Math.sin(t * 0.3) * 0.35);
      el = 0.22;
      d = fitDistance(5.4, 5.4, cam.fov, aspect, 1.25);
    } else {
      // покачивание вокруг вида «три четверти»: циферблат всегда к зрителю, без моментов
      // «часы боком»; при наведении — плавно на ¾, чтобы разошедшиеся слои было видно
      const swing = -0.35 + 0.6 * Math.sin(v.spin); // ±35° — никогда не «ребром»
      az = lerp(swing, -0.75, v.hover);
      el = 0.18 + 0.12 * v.hover;
      d = fitDistance(5.4, 5.4, cam.fov, aspect, lerp(1.32, 1.6, v.hover));
    }
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    cam.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    cam.lookAt(0, 0, 0);
  }

  const clock = new THREE.Clock();
  const nav = document.querySelector(".nav");
  let started = false;

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== W || size.y !== H) renderer.setSize(W, H, false);
    renderer.setScissor(0, 0, W, H);
    renderer.clear();
    const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
    let built = false;

    for (const v of views) {
      if (v.el.hidden || !v.el.offsetParent) continue;
      const r = v.el.getBoundingClientRect();
      if (r.width < 4 || r.bottom < navBottom - H * 0.5 || r.top > H * 1.5) continue;
      if (!v.model) {
        if (built) continue;
        build(v);
        built = true;
      }
      if (r.bottom < navBottom || r.top > H) continue;
      // ждём, пока блок проявится (reveal), чтобы часы не повисли над пустой карточкой
      const rv = v.el.closest(".reveal");
      if (rv && !rv.classList.contains("in")) continue;
      if (!v.inAt) v.inAt = t;
      if (t - v.inAt < 0.35) continue;

      // движение
      const target = TOUCH ? smoothstep(0.3, 0.5, heroBreath(t + v.phase * 2, 9, 1)) : (v.hovering ? 1 : 0);
      v.hover += (target - v.hover) * (1 - Math.exp(-dt * 5));
      if (v.mode === "hero") {
        const scrollK = clamp01(-r.top / r.height) * 1.4;
        v.e = REDUCE ? 0 : Math.min(HERO_PEAK, Math.max(heroBreath(t), scrollK * HERO_PEAK));
      } else if (v.mode === "back") {
        v.e = REDUCE ? 0.15 : 0.12 + 0.2 * (0.5 - 0.5 * Math.cos(t * 0.7));
      } else {
        v.e = 0.38 * v.hover;
        if (!REDUCE) v.spin += dt * lerp(0.32, 0.05, v.hover);
      }
      v.model.update(t);
      v.model.explode(v.e, 0.6);
      v.model.group.position.y = Math.sin(t * 0.8 + v.phase) * 0.04;

      aim(v, t, r.width / r.height);
      const top = Math.max(r.top, navBottom);
      renderer.setViewport(r.left, H - r.bottom, r.width, r.height);
      renderer.setScissor(r.left, H - r.bottom, r.width, Math.max(0, r.bottom - top));
      renderer.render(v.scene, v.camera);
      if (!started) {
        started = true;
        document.documentElement.classList.add("has-3d");
      }
    }
  }
  frame();
  window.__showcase = { views: views.length };
}
