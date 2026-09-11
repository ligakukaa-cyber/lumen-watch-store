// Живая 3D-разборка премиум-модели на карточке товара.
// Та же сцена, что на лендинге LUMEN: прокрутка секции или ползунок
// разбирают часы на 11 подписанных слоёв, механизм при этом идёт.
import * as THREE from "three";
import { createWatch, studioEnvironment, addStudioLights, waitForDialFont } from "./watch-model.js";
import { clamp01, lerp, smoothstep, explodeFromScroll, scrollFromExplode, fitDistance } from "./mechanics.js";

export async function mountExplode(variant = "midnight") {
  const section = document.getElementById("explode");
  const canvas = document.getElementById("watch-canvas");
  const slider = document.getElementById("explode-range");
  const sliderVal = document.getElementById("explode-value");
  const labelsEl = document.getElementById("part-labels");
  const introEl = section.querySelector(".stage-copy.intro");
  const outroEl = section.querySelector(".stage-copy.outro");

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (err) {
    document.documentElement.classList.add("no-webgl");
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  addStudioLights(scene);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 200);

  await waitForDialFont();
  const model = createWatch(renderer, variant);
  model.redrawDial();
  const watch = model.group;
  const layers = model.layers;
  scene.add(watch);

  // ---------- подписи ----------
  const labelNodes = layers.map((l) => {
    const el = document.createElement("div");
    el.className = "part-label";
    el.innerHTML = `<span class="pl-dot"></span><span class="pl-line"></span><span class="pl-text">${l.label}</span>`;
    labelsEl.appendChild(el);
    return el;
  });

  // ---------- прокрутка, ползунок, курсор ----------
  let target = 0;
  let current = 0;
  let scrollP = 0;
  let dragging = false;

  function sectionProgress() {
    const r = section.getBoundingClientRect();
    const total = section.offsetHeight - window.innerHeight;
    return total > 0 ? clamp01(-r.top / total) : 0;
  }
  function onScroll() {
    scrollP = sectionProgress();
    if (!dragging) target = explodeFromScroll(scrollP);
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  slider.addEventListener("input", () => {
    dragging = true;
    target = slider.value / 1000;
    const total = section.offsetHeight - window.innerHeight;
    const top = section.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + scrollFromExplode(target) * total, behavior: "instant" });
  });
  const endDrag = () => { dragging = false; };
  slider.addEventListener("change", endDrag);
  slider.addEventListener("pointerup", endDrag);

  const pointer = { x: 0, y: 0 };
  window.addEventListener("pointermove", (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  // ---------- размер и камера ----------
  let W = 1, H = 1, portrait = false;
  function resize() {
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    portrait = W / H < 0.9;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    let k = 0;
    layers.forEach((l, i) => {
      if (l.key === "crown") {
        l.side = portrait ? "right" : "bottom";
        l.len = 40;
      } else {
        l.side = portrait ? (k % 2 ? "left" : "right") : "top";
        l.len = portrait ? 22 : 30;
        k++;
      }
      l.tw = 0;
      labelNodes[i].dataset.side = l.side;
      labelNodes[i].style.setProperty("--len", `${l.len}px`);
    });
  }
  window.addEventListener("resize", resize);

  const tmpV = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  // Собранные — вид на циферблат; при разборке камера облетает на сторону механизма.
  function placeCamera(e) {
    const aspect = W / H;
    const ce = smoothstep(0, 1, e);
    const az = portrait ? lerp(-0.2, 2.95, ce) : lerp(-0.34, 2.0, ce);
    const el = portrait ? lerp(0.2, 0.9, ce) : lerp(0.2, 0.36, ce);
    const dA = portrait ? fitDistance(5.2, 5.2, camera.fov, aspect, 1.4) : fitDistance(5.2 * 2.1, 5.2, camera.fov, aspect, 1.12);
    const dE = portrait ? fitDistance(5.6, 9.2, camera.fov, aspect, 1.06) : fitDistance(10.4, 7.6, camera.fov, aspect, 1.02);
    const d = lerp(dA, dE, ce);
    camera.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d);
    lookAt.set(0, 0, lerp(0, -0.25, e));
    camera.position.add(lookAt);
    camera.lookAt(lookAt);
    const shiftX = portrait ? 0 : 0.22 * (1 - smoothstep(0, 0.6, e));
    const shiftY = portrait ? -0.2 * (1 - smoothstep(0, 0.5, e)) : -0.04 * smoothstep(0.4, 1, e);
    camera.setViewOffset(W, H, -W * shiftX, H * shiftY, W, H);
  }

  // Точка на краю детали с той стороны, где стоит подпись (в пикселях).
  function anchorPoint(l, side) {
    const [ax, ay, az] = l.anchor;
    const r = Math.hypot(ax, ay);
    if (l.key === "crown") tmpV.set(ax, ay, az);
    else if (side === "top") tmpV.set(0, r, az);
    else if (side === "bottom") tmpV.set(0, -r, az);
    else tmpV.set(side === "right" ? r : -r, 0, az);
    l.group.localToWorld(tmpV);
    tmpV.project(camera);
    return { x: (tmpV.x * 0.5 + 0.5) * W, y: (-tmpV.y * 0.5 + 0.5) * H };
  }

  // Узкий экран: подписи по бокам; не влезает — на другую сторону или к краю.
  const SIDE_LEN = 16;
  function placeSideLabels(pts) {
    // головка тоже в общем чередовании — иначе на телефоне налезает на «Корпус»
    const idx = layers.map((_, i) => i).sort((a, b) => pts[a].y - pts[b].y);
    const placed = []; // прямоугольники уже поставленных подписей
    idx.forEach((i, rank) => {
      const l = layers[i];
      const node = labelNodes[i];
      if (!l.tw) {
        const t = node.querySelector(".pl-text");
        l.tw = t.offsetWidth;
        l.th = t.offsetHeight;
      }
      const pr = anchorPoint(l, "right");
      const pl = anchorPoint(l, "left");
      const fitsR = pr.x + SIDE_LEN + l.tw <= W - 6;
      const fitsL = pl.x - SIDE_LEN - l.tw >= 6;
      let side = rank % 2 ? "left" : "right";
      if (side === "right" && !fitsR && fitsL) side = "left";
      else if (side === "left" && !fitsL && fitsR) side = "right";
      const p = side === "right" ? pr : pl;
      // текст целиком на экране, даже если сама точка ушла за край
      const L = side === "right" ? p.x + SIDE_LEN : p.x - SIDE_LEN - l.tw;
      const tx = Math.min(Math.max(L, 6), W - 6 - l.tw) - L;
      // подписи не наезжают друг на друга (в том числе с разных сторон) — сдвигаем вниз
      const x0 = L + tx;
      let ty = 0;
      for (let guard = 0; guard < 12; guard++) {
        const top = p.y - l.th / 2 + ty;
        const hit = placed.find((r) => x0 < r.r && r.l < x0 + l.tw && top < r.b && r.t < top + l.th);
        if (!hit) break;
        ty = hit.b + 3 - (p.y - l.th / 2);
      }
      placed.push({ l: x0, r: x0 + l.tw, t: p.y - l.th / 2 + ty, b: p.y - l.th / 2 + ty + l.th });
      pts[i] = p;
      node.dataset.side = side;
      node.style.setProperty("--len", `${SIDE_LEN}px`);
      node.style.setProperty("--tx", `${tx.toFixed(0)}px`);
      node.style.setProperty("--ty", `${ty.toFixed(0)}px`);
    });
  }

  // ---------- кадр ----------
  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(section);
  const clock = new THREE.Clock();
  let lastLabels = -1;

  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    current += (target - current) * (1 - Math.exp(-dt * 7));
    if (Math.abs(target - current) < 1e-4) current = target;

    model.update(t);
    model.explode(current, portrait ? 0.95 : 0.78);

    watch.rotation.y += (pointer.x * 0.18 - watch.rotation.y) * 0.05;
    watch.rotation.x += (pointer.y * 0.12 - watch.rotation.x) * 0.05;
    watch.position.y = Math.sin(t * 0.8) * 0.04;

    placeCamera(current);
    renderer.render(scene, camera);

    if (!dragging) slider.value = String(Math.round(current * 1000));
    sliderVal.textContent = `${Math.round(current * 100)}%`;
    introEl.style.opacity = String(1 - smoothstep(0.02, 0.1, scrollP));
    introEl.style.transform = `translateY(${-40 * smoothstep(0.02, 0.1, scrollP)}px)`;
    outroEl.style.opacity = String(smoothstep(0.76, 0.86, scrollP));

    const labelAlpha = smoothstep(0.72, 0.95, current);
    if (labelAlpha > 0 || lastLabels > 0) {
      watch.updateMatrixWorld();
      const pts = layers.map((l) => anchorPoint(l, l.side));
      if (portrait) placeSideLabels(pts);
      // верхние подписи — в три ряда по порядку слева направо, как на чертеже
      const tops = layers.map((_, i) => i).filter((i) => layers[i].side === "top").sort((a, b) => pts[a].x - pts[b].x);
      if (tops.length) {
        const minY = Math.min(...tops.map((i) => pts[i].y));
        tops.forEach((i, rank) => {
          const rowY = Math.max(96, minY - 34 - (rank % 3) * 40);
          labelNodes[i].style.setProperty("--len", `${Math.max(12, pts[i].y - rowY).toFixed(0)}px`);
        });
      }
      layers.forEach((l, i) => {
        labelNodes[i].style.transform = `translate3d(${pts[i].x.toFixed(1)}px, ${pts[i].y.toFixed(1)}px, 0)`;
        labelNodes[i].style.opacity = String(labelAlpha);
      });
    }
    lastLabels = labelAlpha;
  }

  resize();
  onScroll();
  current = target;
  window.__watchReady = { parts: model.partCount, layers: layers.length };
  frame();
}
