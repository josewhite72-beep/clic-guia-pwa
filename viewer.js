import { getImage } from "./db.js";

export class Flipbook {
  constructor(container, guide) {
    this.container = container;
    this.guide = guide;
    this.current = 0;
    this.pageElements = [];
    this.objectUrls = [];
    this.onUpdate = null;
  }

  async render() {
    this.destroy();

    const pages = this.guide?.pages ?? [];

    if (!pages.length) {
      this.container.innerHTML = '<p class="muted">Sin páginas.</p>';
      this.onUpdate?.(0, 0);
      return;
    }

    for (const [index, page] of pages.entries()) {
      const blob = await getImage(page.imageId);
      if (!blob) continue;

      const url = URL.createObjectURL(blob);
      this.objectUrls.push(url);

      const pageEl = document.createElement("div");
      pageEl.className = "page";

      const front = document.createElement("div");
      front.className = "face front";

      const img = document.createElement("img");
      img.src = url;
      img.alt = `Página ${index + 1}`;

      front.appendChild(img);

      const back = document.createElement("div");
      back.className = "face back";

      pageEl.appendChild(front);
      pageEl.appendChild(back);

      this.container.appendChild(pageEl);
      this.pageElements.push(pageEl);
    }

    this.update();
  }

  update() {
    const total = this.pageElements.length;

    this.pageElements.forEach((el, index) => {
      const flipped = index < this.current;
      el.classList.toggle("flipped", flipped);
      el.style.zIndex = flipped ? index + 1 : total * 2 - index;
    });

    this.onUpdate?.(this.current, total);
  }

  next() {
    if (this.current < this.pageElements.length) {
      this.current += 1;
      this.update();
    }
  }

  prev() {
    if (this.current > 0) {
      this.current -= 1;
      this.update();
    }
  }

  destroy() {
    this.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.objectUrls = [];
    this.pageElements = [];
    this.container.innerHTML = "";
  }
}