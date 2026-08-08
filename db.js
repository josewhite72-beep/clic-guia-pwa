const DB_NAME = "clicguia-db";
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains("guides")) {
          db.createObjectStore("guides", { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains("images")) {
          db.createObjectStore("images", { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

export async function saveGuide(guide) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("guides", "readwrite");
    const request = tx.objectStore("guides").put(guide);
    request.onsuccess = () => resolve(guide);
    request.onerror = () => reject(request.error);
  });
}

export async function getGuides() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("guides", "readonly");
    const request = tx.objectStore("guides").getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function getGuide(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("guides", "readonly");
    const request = tx.objectStore("guides").get(id);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteGuide(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("guides", "readwrite");
    const request = tx.objectStore("guides").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function saveImage(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    const request = tx.objectStore("images").put({ id, blob, updatedAt: Date.now() });
    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);
  });
}

export async function getImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readonly");
    const request = tx.objectStore("images").get(id);
    request.onsuccess = () => resolve(request.result?.blob ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("images", "readwrite");
    const request = tx.objectStore("images").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}