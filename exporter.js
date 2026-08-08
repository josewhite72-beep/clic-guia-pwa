import { getImage } from "./db.js";
import { downloadBlob, safeFileName } from "./share.js";

export async function exportGuideHTML(guide) {
  const pages = await collectEmbeddedPages(guide);
  const html = buildViewerHTML(guide, pages, { zip: false });
  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `${safeFileName(guide.title)}.html`);
}

export async function exportGuideZIP(guide, publishUrl = "") {
  const encoder = new TextEncoder();
  const slug = safeFileName(guide.title);
  const { pages, assetFiles } = await collectPackagePages(guide);
  const files = [];

  let iconFile = null;
  const firstBlob = await getFirstPageBlob(guide);

  if (firstBlob) {
    const iconBlob = await makeSquareIconBlob(firstBlob);
    if (iconBlob) {
      iconFile = "icon-512.png";
      files.push({ name: iconFile, data: new Uint8Array(await iconBlob.arrayBuffer()) });
    }
  }

  const url = (publishUrl || "").trim();
  const firstAsset = assetFiles[0];
  const ogImage = url ? `${url}${iconFile || (firstAsset ? firstAsset.name : "")}` : "";

  files.unshift({
    name: "index.html",
    data: encoder.encode(buildViewerHTML(guide, pages, { zip: true, ogUrl: url, ogImage }))
  });

  const assetPaths = ["./", "./index.html", "./manifest.webmanifest", "./sw.js"];
  if (iconFile) assetPaths.push(`./${iconFile}`);

  for (const a of assetFiles) {
    assetPaths.push(`./${a.name}`);
    files.push(a);
  }

  files.push({ name: "sw.js", data: encoder.encode(buildGuideSwJs(slug, assetPaths)) });
  files.push({ name: "manifest.webmanifest", data: encoder.encode(buildManifestJson(guide, iconFile)) });
  files.push({
    name: "book.json",
    data: encoder.encode(JSON.stringify({
      id: guide.id,
      title: guide.title,
      exportedAt: new Date().toISOString(),
      generator: "ClicGuía PWA",
      pageCount: guide.pages?.length ?? 0,
      publicUrl: url
    }, null, 2))
  });

  downloadBlob(createZip(files), `${slug}.zip`);
}

async function getFirstPageBlob(guide) {
  for (const p of guide.pages ?? []) {
    const b = await getImage(p.imageId);
    if (b) return b;
  }
  return null;
}

async function makeSquareIconBlob(blob, size = 512) {
  try {
    const bitmap = await createImageBitmap(blob);
    try { return await drawSquareIcon(bitmap, size); }
    finally { bitmap.close?.(); }
  } catch (e) { console.warn(e); return null; }
}

async function drawSquareIcon(src, size) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, size, size);
  const s = Math.min(size / w, size / h), dw = w * s, dh = h * s;
  ctx.drawImage(src, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return new Promise((r) => canvas.toBlob(r, "image/png"));
}

function buildManifestJson(guide, iconFile) {
  const title = guide.title || "Guía";
  return JSON.stringify({
    name: title,
    short_name: title.slice(0, 12),
    start_url: "./index.html",
    scope: "./",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: iconFile ? [{ src: `./${iconFile}`, sizes: "512x512", type: "image/png", purpose: "any" }] : []
  }, null, 2);
}

function buildGuideSwJs(slug, assetPaths) {
  return `const CACHE_NAME = "guia-${slug}-v1";
const ASSETS = ${JSON.stringify(assetPaths)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => Promise.allSettled(ASSETS.map((u) => c.add(u)))));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("guia-") && k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((c) => c || fetch(req).then((r) => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE_NAME).then((cc) => cc.put(req, cp)); }
      return r;
    }).catch(async () => {
      if (req.mode === "navigate") { const f = await caches.match("./index.html"); if (f) return f; }
      return new Response("Offline", { status: 503 });
    }))
  );
});
`;
}

async function collectEmbeddedPages(guide) {
  const pages = [];
  for (const p of guide.pages ?? []) {
    const b = await getImage(p.imageId);
    if (b) pages.push({ src: await blobToDataUrl(b) });
  }
  return pages;
}

async function collectPackagePages(guide) {
  const assetFiles = []; const pages = []; let i = 0;
  for (const p of guide.pages ?? []) {
    const b = await getImage(p.imageId);
    if (!b) continue;
    i++;
    const name = `assets/page-${String(i).padStart(3, "0")}.${extensionFromMime(b.type)}`;
    assetFiles.push({ name, data: new Uint8Array(await b.arrayBuffer()) });
    pages.push({ src: name });
  }
  return { pages, assetFiles };
}

function buildViewerHTML(guide, pages, opts = {}) {
  const serialized = JSON.stringify(pages).replace(/</g, "\\u003c");
  const title = escapeHtml(guide.title || "Guía");

  let headExtra = "";
  let tailExtra = "";

  if (opts.zip) {
    headExtra = `\n  <link rel="manifest" href="./manifest.webmanifest" />\n  <meta name="theme-color" content="#0f172a" />`;

    if (opts.ogUrl) {
      headExtra += `\n  <meta property="og:type" content="website" />\n  <meta property="og:title" content="${title}" />\n  <meta property="og:description" content="Guía interactiva paso a paso" />\n  <meta property="og:url" content="${escapeHtml(opts.ogUrl)}" />`;
      if (opts.ogImage) {
        headExtra += `\n  <meta property="og:image" content="${escapeHtml(opts.ogImage)}" />\n  <meta name="twitter:card" content="summary_large_image" />`;
      }
    }

    tailExtra = `\n  <script>\n    if ("serviceWorker" in navigator) { window.addEventListener("load", function () { navigator.serviceWorker.register("./sw.js").catch(function () {}); }); }\n  </script>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>${headExtra}
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0f172a;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.app{min-height:100dvh;display:flex;flex-direction:column}.bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;background:#1e293b;border-bottom:1px solid #334155}.bar h1{margin:0;font-size:1.1rem}.status{color:#94a3b8;margin-left:auto}.controls{display:flex;gap:8px}button{border:0;border-radius:12px;padding:10px 14px;background:#334155;color:#fff;cursor:pointer;font:inherit}button:hover{background:#475569}.stage{flex:1;display:grid;place-items:center;padding:24px;overflow:hidden}.book{width:min(92vw,520px);aspect-ratio:3/4;position:relative;perspective:2200px;transform-style:preserve-3d;cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation}.page{position:absolute;inset:0;transform-origin:left center;transition:transform .65s ease;transform-style:preserve-3d}.page.flipped{transform:rotateY(-180deg)}.face{position:absolute;inset:0;-webkit-backface-visibility:hidden;backface-visibility:hidden;background:#fff;overflow:hidden;border-radius:6px;box-shadow:0 10px 30px rgb(0 0 0/.3)}.face.back{transform:rotateY(180deg);background:#dedede}.face img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}.empty{color:#0f172a;background:#fff;padding:1rem;border-radius:8px;text-align:center}.hint{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#0ea5e9;color:#04222e;font-weight:600;padding:10px 18px;border-radius:999px;box-shadow:0 8px 24px rgb(0 0 0/.4);animation:p 1.6s infinite;z-index:20;pointer-events:none}@keyframes p{0%,100%{transform:translateX(-50%) scale(1)}50%{transform:translateX(-50%) scale(1.06)}}
</style>
</head>
<body>
<main class="app">
<header class="bar">
<h1>${title}</h1>
<span id="status" class="status"></span>
<div class="controls"><button id="prev">←</button><button id="next">→</button></div>
</header>
<section class="stage"><div id="book" class="book"></div></section>
</main>
<div id="hint" class="hint">👆 Toca la imagen para avanzar</div>${tailExtra}
<script>
(function(){
const PAGES=${serialized};
const book=document.getElementById("book"),status=document.getElementById("status"),hint=document.getElementById("hint");
let current=0,startX=null;
function render(){book.innerHTML="";PAGES.forEach(function(page,index){var el=document.createElement("div");el.className="page";var f=document.createElement("div");f.className="face front";var img=document.createElement("img");img.src=page.src;img.alt="Página "+(index+1);img.draggable=false;f.appendChild(img);var b=document.createElement("div");b.className="face back";el.appendChild(f);el.appendChild(b);book.appendChild(el);});update();}
function update(){var els=Array.from(book.children);els.forEach(function(el,i){var fl=i<current;el.classList.toggle("flipped",fl);el.style.zIndex=fl?i+1:PAGES.length*2-i;});if(!PAGES.length){status.textContent="Sin páginas";return;}status.textContent="Página "+Math.min(current+1,PAGES.length)+" de "+PAGES.length;if(hint)hint.style.display=current===0?"":"none";}
function next(){if(current<PAGES.length){current++;update();}}
function prev(){if(current>0){current--;update();}}
book.addEventListener("pointerdown",function(e){startX=e.clientX;});
book.addEventListener("pointerup",function(e){if(startX===null)return;var dx=e.clientX-startX;startX=null;if(Math.abs(dx)>40){if(dx<0)next();else prev();return;}var r=book.getBoundingClientRect();if(e.clientX-r.left<r.width*0.3)prev();else next();});
document.getElementById("next").addEventListener("click",next);
document.getElementById("prev").addEventListener("click",prev);
document.addEventListener("keydown",function(e){if(e.key==="ArrowRight")next();if(e.key==="ArrowLeft")prev();});
if(!PAGES.length){book.innerHTML='<p class="empty">Sin páginas</p>';status.textContent="Sin páginas";if(hint)hint.style.display="none";return;}
render();
})();
</script>
</body>
</html>`;
}

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function extensionFromMime(t) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg", "image/avif": "avif" }[t] || "bin";
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(data) {
  let c = -1;
  for (let i = 0; i < data.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ data[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function dosDateTime(d = new Date()) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

function createZip(files) {
  const enc = new TextEncoder();
  const chunks = []; const central = []; let offset = 0;
  const { time, date } = dosDateTime();

  for (const file of files) {
    const name = enc.encode(file.name);
    const data = file.data;
    const crc = crc32(data);

    const lh = new ArrayBuffer(30 + name.length);
    const lv = new DataView(lh); const la = new Uint8Array(lh);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    la.set(name, 30);
    chunks.push(la, data);

    const ch = new ArrayBuffer(46 + name.length);
    const cv = new DataView(ch); const ca = new Uint8Array(ch);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    ca.set(name, 46);
    central.push(ca);

    offset += la.byteLength + data.length;
  }

  const centralSize = central.reduce((s, a) => s + a.length, 0);
  const eo = new ArrayBuffer(22); const ev = new DataView(eo);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);

  return new Blob([...chunks, ...central, new Uint8Array(eo)], { type: "application/zip" });
}