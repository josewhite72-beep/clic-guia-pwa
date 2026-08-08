export function parseExportedHTML(text) {
  const titleMatch = text.match(/<title>([\s\S]*?)<\/title>/);
  const pagesMatch = text.match(/const PAGES = (\[[\s\S]*?\]);/);

  if (!pagesMatch) {
    throw new Error("El HTML no parece un flipbook exportado.");
  }

  const pages = JSON.parse(pagesMatch[1]);

  return {
    title: titleMatch ? titleMatch[1].trim() : "Guía importada",
    srcs: pages.map((p) => p.src).filter(Boolean)
  };
}

export async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return await response.blob();
}

export async function optimizeImage(file, maxWidth = 1600, quality = 0.85) {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    try {
      return await canvasFromSource(bitmap, file, maxWidth, quality);
    } finally {
      bitmap.close?.();
    }
  } catch (error) {
    console.warn("createImageBitmap falló.", error);
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });

    try {
      return await canvasFromSource(image, file, maxWidth, quality);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    console.warn("No se pudo optimizar la imagen.", error);
    return file;
  }
}

async function canvasFromSource(source, fallback, maxWidth, quality) {
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;

  if (!width || !height) return fallback;

  const scale = Math.min(1, maxWidth / width);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const webp = await new Promise((r) => canvas.toBlob(r, "image/webp", quality));
  if (webp) return webp;

  const jpeg = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
  return jpeg || fallback;
}