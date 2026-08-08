export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(name) {
  const base = String(name || "guia").trim().toLowerCase();
  const normalized = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.replace(/[^a-z0-9\-_]+/g, "-").replace(/^-+|-+$/g, "") || "guia";
}

export function buildShareUrl(baseUrl, slug) {
  const b = (baseUrl || "").trim().replace(/\/+$/, "");
  return b ? `${b}/${slug}/` : "";
}

export async function qrDataUrl(text, size = 600) {
  if (!window.QRCode) throw new Error("Generador de QR no disponible. Conéctate una vez a internet.");
  return await QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
}

export async function downloadQrPng(text, filename) {
  const dataUrl = await qrDataUrl(text);
  const blob = await (await fetch(dataUrl)).blob();
  downloadBlob(blob, filename);
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  return loadImage(url).finally(() => URL.revokeObjectURL(url));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawContain(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = Math.min(w / iw, h / ih), dw = iw * s, dh = ih * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/); const lines = []; let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function truncate(t, max) { return t.length > max ? t.slice(0, max - 1) + "…" : t; }

export async function generateCoverBlob({ title, coverBlob, url }) {
  const W = 1080, H = 1620;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#0ea5e9"; ctx.fillRect(0, 0, W, 12);
  ctx.fillStyle = "#38bdf8"; ctx.font = "600 44px system-ui, sans-serif";
  ctx.fillText("👆 ClicGuía", 60, 92);

  ctx.fillStyle = "#ffffff"; roundRect(ctx, 60, 140, W - 120, 720, 24); ctx.fill();
  if (coverBlob) {
    try { drawContain(ctx, await blobToImage(coverBlob), 84, 164, W - 168, 672); }
    catch (e) { console.warn(e); }
  }

  ctx.fillStyle = "#ffffff"; ctx.font = "700 62px system-ui, sans-serif";
  const lines = wrapText(ctx, title || "Guía interactiva", W - 120).slice(0, 3);
  let y = 970;
  for (const line of lines) { ctx.fillText(line, 60, y); y += 78; }

  ctx.fillStyle = "#94a3b8"; ctx.font = "400 38px system-ui, sans-serif";
  ctx.fillText("Guía interactiva paso a paso", 60, y + 16);

  const qrImg = await loadImage(await qrDataUrl(url, 600));
  ctx.fillStyle = "#ffffff"; roundRect(ctx, 60, H - 420, 320, 320, 24); ctx.fill();
  ctx.drawImage(qrImg, 80, H - 400, 280, 280);

  ctx.fillStyle = "#e2e8f0"; ctx.font = "600 40px system-ui, sans-serif";
  const hint = wrapText(ctx, "Toca el enlace o escanea el QR para abrir la guía", 600);
  let hy = H - 330;
  for (const l of hint.slice(0, 3)) { ctx.fillText(l, 420, hy); hy += 54; }

  ctx.fillStyle = "#64748b"; ctx.font = "400 28px system-ui, sans-serif";
  ctx.fillText(truncate(url, 46), 420, hy + 6);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}