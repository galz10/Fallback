import { useEffect, useState } from "react";

const databaseName = "fallback-image-cache";
const databaseVersion = 1;
const storeName = "images";
const maxImageBytes = 2 * 1024 * 1024;

type CachedImageRecord = {
  key: string;
  dataUrl: string;
  updatedAt: number;
};

let databasePromise: Promise<IDBDatabase> | null = null;

export function useCachedImageSrc(src: string | null | undefined): string | undefined {
  const [cachedSrc, setCachedSrc] = useState<string | undefined>(() => renderableImageSrc(src));

  useEffect(() => {
    const imageSrc = renderableImageSrc(src);
    if (!imageSrc || imageSrc.startsWith("data:image/")) {
      setCachedSrc(imageSrc);
      return;
    }

    let cancelled = false;
    setCachedSrc(imageSrc);

    void cachedImageDataUrl(imageSrc)
      .then((dataUrl) => {
        if (!cancelled && dataUrl) setCachedSrc(dataUrl);
      })
      .then(() => cacheRemoteImage(imageSrc))
      .then((dataUrl) => {
        if (!cancelled && dataUrl) setCachedSrc(dataUrl);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [src]);

  return cachedSrc;
}

function renderableImageSrc(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("data:image/") || src.startsWith("https://") || src.startsWith("http://")) return src;
  return undefined;
}

async function cachedImageDataUrl(src: string): Promise<string | null> {
  const db = await imageCacheDatabase();
  return new Promise((resolve) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(cacheKey(src));
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(isCachedImageRecord(request.result) ? request.result.dataUrl : null);
  });
}

async function cacheRemoteImage(src: string): Promise<string | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;

  const response = await fetch(src, { headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" } });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return null;

  const blob = await response.blob();
  if (blob.size === 0 || blob.size > maxImageBytes) return null;

  const dataUrl = await blobToDataUrl(blob);
  const db = await imageCacheDatabase();
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put({ key: cacheKey(src), dataUrl, updatedAt: Date.now() } satisfies CachedImageRecord);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
  return dataUrl;
}

function imageCacheDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  if (!databasePromise) {
    const nextDatabasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onerror = () => reject(request.error ?? new Error("Unable to open image cache."));
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "key" });
      };
    });
    databasePromise = nextDatabasePromise.catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

function cacheKey(src: string): string {
  return `image:${src}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function isCachedImageRecord(value: unknown): value is CachedImageRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CachedImageRecord).key === "string" &&
    typeof (value as CachedImageRecord).dataUrl === "string"
  );
}
