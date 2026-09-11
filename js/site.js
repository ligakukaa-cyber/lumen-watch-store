// Логика сайта LUMEN: каталог из catalog.json, фильтры, карточка товара,
// заявка на покупку. Живой 3D подгружается только на странице премиум-модели.

// ---------- проверка заявки (зеркало order.py) ----------
const PHONE_RE = /^\+?\d[\d\s\-()]{9,}$/;
const TELEGRAM_RE = /^@[A-Za-z0-9_]{5,32}$/;

export function formatPrice(rub) {
  return String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
}

export function validateOrder(name, contact, model, models) {
  name = (name || "").trim();
  contact = (contact || "").trim();
  const errors = {};
  if (name.length < 2) errors.name = "Введите имя (минимум 2 символа)";
  if (!(PHONE_RE.test(contact) || TELEGRAM_RE.test(contact))) {
    errors.contact = "Укажите телефон (+7...) или Telegram (@username)";
  }
  const item = models.find((m) => m.slug === model);
  if (!item) errors.model = "Выберите модель";
  return {
    ok: Object.keys(errors).length === 0, errors, name, contact,
    model: item ? item.title : null, price: item ? formatPrice(item.price) : null,
  };
}

// ---------- общее ----------
const METAL = { steel: "Сталь", gold: "Золотой тон" };
const photo = (m, view) => `assets/${m.variant}-${view}.jpg`;
const productUrl = (m) => `product.html?m=${m.slug}`;

function cardHTML(m) {
  return `
    <a class="card reveal" href="${productUrl(m)}">
      <div class="card-media">
        ${m.premium ? '<span class="badge-3d">✦ 3D-разборка</span>' : ""}
        <img class="main" src="${photo(m, "front")}" alt="${m.title}" loading="lazy">
        <img class="alt" src="${photo(m, "angle")}" alt="" loading="lazy">
        <div class="watch3d" data-watch3d data-variant="${m.variant}" data-mode="turntable" aria-hidden="true"></div>
      </div>
      <div class="card-body">
        <div class="metal">${METAL[m.metal]}</div>
        <h3>${m.title}</h3>
        <div class="row"><span class="price">${formatPrice(m.price)}</span><span class="more">Подробнее →</span></div>
      </div>
    </a>`;
}

function observeReveal(root = document) {
  const els = root.querySelectorAll(".reveal:not(.in)");
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  els.forEach((el) => io.observe(el));
}

// ---------- страницы ----------
function initHome(data) {
  document.getElementById("home-cards").innerHTML = data.models.map(cardHTML).join("");
}

function initCatalog(data) {
  const grid = document.getElementById("catalog-grid");
  const count = document.getElementById("catalog-count");
  const sort = document.getElementById("catalog-sort");
  // Карточки рисуем один раз: фильтр прячет лишние, сортировка меняет CSS order —
  // живые 3D-часы в карточках не пересоздаются на каждый клик.
  grid.innerHTML = data.models.map(cardHTML).join("");
  const cards = [...grid.children];
  let metal = "all";
  function apply() {
    const byPrice = [...data.models].sort((a, b) => (sort.value === "desc" ? b.price - a.price : a.price - b.price));
    let shown = 0;
    data.models.forEach((m, i) => {
      const visible = metal === "all" || m.metal === metal;
      cards[i].hidden = !visible;
      cards[i].style.order = String(sort.value === "default" ? i : byPrice.indexOf(m));
      if (visible) shown++;
    });
    count.textContent = `${shown} из ${data.models.length}`;
  }
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
      metal = chip.dataset.metal;
      apply();
    });
  });
  sort.addEventListener("change", apply);
  apply();
}

function initProduct(data) {
  const slug = new URLSearchParams(location.search).get("m");
  const m = data.models.find((x) => x.slug === slug) || data.models.find((x) => x.premium);
  document.title = `${m.title} — LUMEN`;
  document.getElementById("crumb-title").textContent = m.title;
  document.getElementById("p-title").textContent = m.title;
  document.getElementById("p-tagline").textContent = m.tagline;
  document.getElementById("p-price").textContent = formatPrice(m.price);
  document.getElementById("p-badges").innerHTML =
    (m.premium ? '<span class="badge-3d">✦ Премиум · 3D-разборка</span>' : "");

  // галерея: живой 3D (по умолчанию), фронт, три четверти, задняя крышка с механизмом
  const views = [["3d", "Живой 3D"], ["front", "Циферблат"], ["angle", "Три четверти"], ["back", "Механизм через заднюю крышку"]];
  const main = document.getElementById("g-main");
  const g3d = document.getElementById("g-3d");
  const thumbs = document.getElementById("g-thumbs");
  g3d.dataset.variant = m.variant;
  main.src = photo(m, "front");
  main.alt = `${m.title} — ${views[1][1]}`;
  main.classList.add("under3d");
  thumbs.innerHTML = views.map(([v, label], i) =>
    `<button class="thumb${v === "3d" ? " t3d" : ""}${i === 0 ? " active" : ""}" data-view="${v}" aria-label="${label}">`
    + `<img src="${photo(m, v === "3d" ? "angle" : v)}" alt="">${v === "3d" ? "<span>3D</span>" : ""}</button>`).join("");
  thumbs.addEventListener("click", (e) => {
    const b = e.target.closest(".thumb");
    if (!b) return;
    thumbs.querySelectorAll(".thumb").forEach((t) => t.classList.toggle("active", t === b));
    if (b.dataset.view === "3d") {
      g3d.hidden = false;
      main.classList.add("under3d");
      return;
    }
    g3d.hidden = true;
    main.classList.remove("under3d");
    main.style.opacity = "0";
    setTimeout(() => {
      main.src = photo(m, b.dataset.view);
      main.alt = `${m.title} — ${b.getAttribute("aria-label")}`;
      main.style.opacity = "1";
    }, 180);
  });

  // исполнения — переходы на соседние модели
  document.getElementById("p-swatches").innerHTML = data.models.map((x) =>
    `<a class="swatch${x.slug === m.slug ? " current" : ""}" href="${productUrl(x)}" title="${x.title}"
        style="--dial:${x.swatch[0]};--case:${x.swatch[1]}" aria-label="${x.title}"></a>`).join("");

  const specs = [
    ["Циферблат", m.dial], ["Корпус", m.case], ["Стрелки и индексы", m.accents], ...data.specs,
  ];
  document.getElementById("p-specs").innerHTML = specs.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");

  const others = data.models.filter((x) => x.slug !== m.slug);
  document.getElementById("more-cards").innerHTML = others.map(cardHTML).join("");

  if (m.premium) {
    document.getElementById("explode").hidden = false;
    document.getElementById("p-3d-link").hidden = false;
    import("./explode-stage.js").then((mod) => mod.mountExplode(m.variant));
  } else {
    document.getElementById("banner-3d").hidden = false;
  }
  initOrderForm(data, m.slug);
}

function initOrderForm(data, preselect) {
  const form = document.getElementById("order-form");
  const select = document.getElementById("f-model");
  select.innerHTML = '<option value="">Выберите модель</option>' + data.models.map((m) =>
    `<option value="${m.slug}"${m.slug === preselect ? " selected" : ""}>${m.title} — ${formatPrice(m.price)}</option>`).join("");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = validateOrder(
      document.getElementById("f-name").value,
      document.getElementById("f-contact").value,
      select.value,
      data.models,
    );
    for (const k of ["name", "contact", "model"]) {
      document.getElementById(`err-${k}`).textContent = r.errors[k] || "";
    }
    const note = document.getElementById("form-note");
    note.className = "form-note";
    note.textContent = "";
    if (!r.ok) return;
    note.classList.add("ok");
    note.textContent = `Заявка сформирована (демо-режим): ${r.name}, ${r.contact} — ${r.model}, ${r.price}. `
      + "На настоящем сайте она ушла бы менеджеру в Telegram или CRM.";
    form.reset();
    select.value = preselect;
  });
}

// ---------- запуск ----------
const page = document.body.dataset.page;
fetch("catalog.json")
  .then((r) => r.json())
  .then((data) => {
    if (page === "home") initHome(data);
    if (page === "catalog") initCatalog(data);
    if (page === "product") initProduct(data);
    observeReveal();
    // живые 3D-часы в витринах; без WebGL остаются фото
    import("./showcase-3d.js").then((mod) => mod.mountShowcase()).catch(() => {});
  });
