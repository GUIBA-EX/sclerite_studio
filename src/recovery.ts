import type { ImageEntry } from "./types";
import { DEFAULT_PLATE_SETTINGS } from "./plate";
import type { PlateItem, PlateBackground, PlateSettings } from "./plate";
import { loadImage } from "./io";
type StoredImage = Omit<ImageEntry, "data" | "url">;
export type Recovery = {
  version: 1;
  date: string;
  images: StoredImage[];
  items: PlateItem[];
  background?: PlateBackground;
  settings?: PlateSettings;
};
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("sclerite-recovery", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readRecovery(): Promise<Recovery | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("snapshots")
        .objectStore("snapshots")
        .get("latest");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function writeRecovery(
  images: ImageEntry[],
  items: PlateItem[],
  background: PlateBackground = "white",
  settings: PlateSettings = { ...DEFAULT_PLATE_SETTINGS },
): Promise<void> {
  const snapshot: Recovery = {
    version: 1,
    date: new Date().toISOString(),
    images: images.map(({ data: _data, url: _url, ...e }) => ({
      ...e,
      undo: [],
    })),
    items,
    background,
    settings,
  };
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("snapshots", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore("snapshots").put(snapshot, "latest");
    });
  } finally {
    db.close();
  }
}
export async function restoreRecovery(
  snapshot: Recovery,
): Promise<ImageEntry[]> {
  if (snapshot.version !== 1) throw new Error("不支持的恢复快照");
  const entries: ImageEntry[] = [];
  try {
    for (const e of snapshot.images) {
      const decoded = await loadImage(
        new File([e.original], e.name, { type: e.original.type }),
        e.synthetic,
      );
      entries.push({
        ...decoded,
        ...e,
        data: decoded.data,
        url: decoded.url,
        undo: [],
      });
    }
    return entries;
  } catch (error) {
    entries.forEach((e) => URL.revokeObjectURL(e.url));
    throw error;
  }
}
