import { getGuides, getGuide, saveGuide, deleteGuide, saveImage, getImage, deleteImage } from "./db.js";
import { Flipbook } from "./viewer.js";
import { parseExportedHTML, dataUrlToBlob, optimizeImage } from "./importer.js";
import { exportGuideHTML, exportGuideZIP } from "./exporter.js";
import { buildShareUrl, safeFileName, downloadBlob, downloadQrPng, generateCoverBlob } from "./share.js";

const BASE_KEY = "clicguia.baseUrl";

const homeView = document.querySelector("#homeView");
const editorView = document.querySelector("#editorView");
const viewerView = document.querySelector("#viewerView");
const shareView = document.querySelector("#shareView");

const guideList = document.querySelector("#guideList");
const newImagesInput = document.querySelector("#newImagesInput");
const importHtmlInput = document.querySelector("#importHtmlInput");

const backHomeBtn = document.querySelector("#backHomeBtn");
const titleInput = document.querySelector("#titleInput");
const shareBtn = document.querySelector("#shareBtn");
const addImagesInput = document.querySelector("#addImagesInput");
const viewBtn = document.querySelector("#viewBtn");
const pageCount = document.querySelector("#pageCount");
const thumbs = document.querySelector("#thumbs");

const closeViewerBtn = document.querySelector("#closeViewerBtn");
const pageStatus = document.querySelector("#pageStatus");
const prevBtn = document.querySelector("#prevBtn");
const nextBtn = document.querySelector("#nextBtn");
const bookContainer = document.querySelector("#book");

const backEditorBtn = document.querySelector("#backEditorBtn");
const baseUrlInput = document.querySelector("#baseUrlInput");
const linkInput = document.querySelector("#linkInput");
const copyBtn = document.querySelector("#copyBtn");
const qrBtn = document.querySelector("#qrBtn");
const coverBtn = document.querySelector("#coverBtn");
const htmlBtn = document.querySelector("#htmlBtn");
const zipBtn = document.querySelector("#zipBtn");

let currentGuide = null;
let flipbook = null;
let thumbUrls = [];
let saveTimer = null;

init();

function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }
  bindEvents();
  void showHome();
}

function bindEvents() {
  newImagesInput.addEventListener("change", handleNewImages);
  importHtmlInput.addEventListener("change", handleImportHtml);
  backHomeBtn.addEventListener("click", () => void showHome());

  titleInput.addEventListener("input", () => {
    if (!currentGuide) return;
    currentGuide.title = titleInput.value;
    scheduleSave();
  });

  addImagesInput.addEventListener("change", handleAddImages);
  viewBtn.addEventListener("click", () => void showViewer());
  shareBtn.addEventListener("click", () => void showShare());

  closeViewerBtn.addEventListener("click", closeViewer);
  prevBtn.addEventListener("click", () => flipbook?.prev());
  nextBtn.addEventListener("click", () => flipbook?.next());

  backEditorBtn.addEventListener("click", () => void showEditor());

  baseUrlInput.addEventListener("input", () => {
    localStorage.setItem(BASE_KEY, baseUrlInput.value.trim());
    updateLink();
  });

  copyBtn.addEventListener("click", () => void copyLink());
  qrBtn.addEventListener("click", () => void handleQr());
  coverBtn.addEventListener("click", () => void handleCover());
  htmlBtn.addEventListener("click", () => runExport(() => exportGuideHTML(currentGuide)));
  zipBtn.addEventListener("click", () => runExport(() => exportGuideZIP(currentGuide, currentShareUrl())));

  document.addEventListener("keydown", (e) => {
    if (viewerView.hidden || !flipbook) return;
    if (e.key === "ArrowRight") flipbook.next();
    if (e.key === "ArrowLeft") flipbook.prev();
  });

  let startX = null;
  bookContainer.addEventListener("pointerdown", (e) => { startX = e.clientX; });
  bookContainer.addEventListener("pointerup", (e) => {
    if (startX === null || !flipbook) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) {
      if (dx < 0) flipbook.next();
      else flipbook.prev();
      return;
    }
    const r = bookContainer.getBoundingClientRect();
    if (e.clientX - r.left < r.width * 0.3) flipbook.prev();
    else flipbook.next();
  });
}

function setView(name) {
  homeView.hidden = name !== "home";
  editorView.hidden = name !== "editor";
  viewerView.hidden = name !== "viewer";
  shareView.hidden = name !== "share";
}

function createId() {
  return window.crypto?.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function handleNewImages(event) {
  const files = Array.from(event.target.files ?? []);
  event.target.value = "";
  if (!files.length) return;

  currentGuide = {
    id: createId(),
    title: "Nueva guía",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    pages: []
  };

  await addFilesToGuide(files);
  titleInput.value = currentGuide.title;
  await showEditor();
}

async function handleImportHtml(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const { title, srcs } = parseExportedHTML(await file.text());

    const guide = {
      id: createId(),
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pages: []
    };

    for (const src of srcs) {
      const blob = await dataUrlToBlob(src);
      const imageId = createId();
      await saveImage(imageId, blob);
      guide.pages.push({ id: createId(), imageId });
    }

    await saveGuide(guide);
    currentGuide = guide;
    titleInput.value = guide.title;
    await showEditor();
  } catch (err) {
    console.error(err);
    window.alert("No se pudo importar. Asegúrate de que sea un HTML exportado por ClicGuía o Flip-Book.");
  }
}

async function addFilesToGuide(files) {
  if (!currentGuide) return;

  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const blob = await optimizeImage(file);
      const imageId = createId();
      await saveImage(imageId, blob);
      currentGuide.pages.push({ id: createId(), imageId });
    } catch (e) {
      console.warn(e);
    }
  }

  currentGuide.updatedAt = Date.now();
  await saveGuide(currentGuide);
}

async function handleAddImages(event) {
  const files = Array.from(event.target.files ?? []);
  event.target.value = "";
  if (!currentGuide || !files.length) return;
  await addFilesToGuide(files);
  await renderThumbs();
}

async function showHome() {
  if (flipbook) { flipbook.destroy(); flipbook = null; }
  await persist();
  currentGuide = null;
  setView("home");
  await renderList();
}

async function renderList() {
  const guides = await getGuides();
  guideList.innerHTML = "";

  if (!guides.length) {
    guideList.innerHTML = '<li class="muted">Aún no tienes guías.</li>';
    return;
  }

  for (const g of [...guides].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))) {
    const li = document.createElement("li");
    li.className = "row-item";

    const open = document.createElement("button");
    open.className = "open";
    open.type = "button";
    open.textContent = g.title || "Sin título";
    open.addEventListener("click", () => void openGuide(g.id));

    const del = document.createElement("button");
    del.className = "danger";
    del.type = "button";
    del.textContent = "Eliminar";
    del.addEventListener("click", async () => {
      if (!window.confirm(`¿Eliminar "${g.title}"?`)) return;
      for (const p of g.pages ?? []) await deleteImage(p.imageId).catch(() => {});
      await deleteGuide(g.id);
      await renderList();
    });

    li.appendChild(open);
    li.appendChild(del);
    guideList.appendChild(li);
  }
}

async function openGuide(id) {
  currentGuide = await getGuide(id);
  if (!currentGuide) return;
  titleInput.value = currentGuide.title || "";
  await showEditor();
}

async function showEditor() {
  setView("editor");
  await renderThumbs();
}

async function renderThumbs() {
  if (!currentGuide) return;

  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls = [];
  thumbs.innerHTML = "";

  if (!currentGuide.pages.length) {
    thumbs.innerHTML = '<p class="muted">Añade imágenes o importa un HTML.</p>';
  }

  for (const [index, page] of currentGuide.pages.entries()) {
    const blob = await getImage(page.imageId);
    if (!blob) continue;

    const url = URL.createObjectURL(blob);
    thumbUrls.push(url);

    const card = document.createElement("div");
    card.className = "thumb";

    const img = document.createElement("img");
    img.src = url;
    img.alt = `Página ${index + 1}`;

    const acts = document.createElement("div");
    acts.className = "acts";

    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "↑";
    up.addEventListener("click", () => void movePage(index, -1));

    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "↓";
    down.addEventListener("click", () => void movePage(index, 1));

    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "✕";
    rm.addEventListener("click", () => void removePage(page.id));

    acts.append(up, down, rm);
    card.append(img, acts);
    thumbs.appendChild(card);
  }

  const n = currentGuide.pages.length;
  pageCount.textContent = `${n} página${n === 1 ? "" : "s"}`;
}

async function movePage(index, delta) {
  if (!currentGuide) return;
  const t = index + delta;
  if (t < 0 || t >= currentGuide.pages.length) return;
  const p = currentGuide.pages;
  [p[index], p[t]] = [p[t], p[index]];
  await persist();
  await renderThumbs();
}

async function removePage(pageId) {
  if (!currentGuide) return;
  const page = currentGuide.pages.find((x) => x.id === pageId);
  if (!page) return;
  if (!window.confirm("¿Eliminar esta página?")) return;

  currentGuide.pages = currentGuide.pages.filter((x) => x.id !== pageId);
  await deleteImage(page.imageId).catch(() => {});
  await persist();
  await renderThumbs();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist(), 600);
}

async function persist() {
  clearTimeout(saveTimer);
  if (!currentGuide) return;
  currentGuide.updatedAt = Date.now();
  await saveGuide(currentGuide);
}

async function showViewer() {
  if (!currentGuide) return;
  setView("viewer");
  flipbook = new Flipbook(bookContainer, currentGuide);
  flipbook.onUpdate = (c, t) => {
    pageStatus.textContent = t ? `Página ${Math.min(c + 1, t)} de ${t}` : "Sin páginas";
  };
  await flipbook.render();
}

function closeViewer() {
  if (flipbook) { flipbook.destroy(); flipbook = null; }
  void showEditor();
}

async function showShare() {
  if (!currentGuide) return;
  setView("share");
  baseUrlInput.value = localStorage.getItem(BASE_KEY) || "";
  updateLink();
}

function currentShareUrl() {
  if (!currentGuide) return "";
  return buildShareUrl(localStorage.getItem(BASE_KEY) || "", safeFileName(currentGuide.title));
}

function updateLink() {
  linkInput.value = currentShareUrl() || "Configura tu base pública arriba";
}

async function copyLink() {
  const url = currentShareUrl();
  if (!url) { window.alert("Configura primero tu base pública."); return; }
  try {
    await navigator.clipboard.writeText(url);
    copyBtn.textContent = "¡Copiado!";
    setTimeout(() => (copyBtn.textContent = "Copiar"), 1500);
  } catch {
    window.alert(url);
  }
}

async function handleQr() {
  const url = currentShareUrl();
  if (!url) { window.alert("Configura primero tu base pública."); return; }
  try {
    await downloadQrPng(url, `${safeFileName(currentGuide.title)}-qr.png`);
  } catch (e) {
    console.error(e);
    window.alert(e.message);
  }
}

async function handleCover() {
  const url = currentShareUrl();
  if (!url) { window.alert("Configura primero tu base pública."); return; }

  let coverBlob = null;
  for (const p of currentGuide.pages ?? []) {
    coverBlob = await getImage(p.imageId);
    if (coverBlob) break;
  }

  try {
    const blob = await generateCoverBlob({
      title: currentGuide.title,
      coverBlob,
      url
    });
    downloadBlob(blob, `${safeFileName(currentGuide.title)}-portada.png`);
  } catch (e) {
    console.error(e);
    window.alert(e.message);
  }
}

async function runExport(fn) {
  if (!currentGuide) return;
  try {
    await persist();
    await fn();
  } catch (e) {
    console.error(e);
    window.alert("No se pudo exportar.");
  }
}