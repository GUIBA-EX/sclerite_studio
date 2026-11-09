import type { ImageEntry } from "./types";
import { DEFAULT_PLATE_SETTINGS } from "./plate";
import type { PlateItem, PlateBackground, PlateSettings } from "./plate";
import { loadImage } from "./io";
import { packLabels, unpackLabels } from "./history";
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
    const request = indexedDB.open("sclerite-recovery", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("snapshots"))
        request.result.createObjectStore("snapshots");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readRecovery(): Promise<Recovery | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots");
      const store = tx.objectStore("snapshots");
      const request = store.get("manifest");
      request.onsuccess = () => {
        const manifest = request.result;
        if (!manifest || manifest.version !== 2) {
          const old = store.get("latest");
          old.onsuccess = () => resolve(old.result);
          return;
        }
        const images: StoredImage[] = new Array(manifest.imageIds.length);
        if (!images.length) { resolve({ ...manifest, version: 1, images }); return; }
        let pending = images.length;
        manifest.imageIds.forEach((id: string, index: number) => {
          const item = store.get(`image:${id}`), original = store.get(`original:${id}`);
          original.onsuccess = () => {
            if (!item.result || !(original.result instanceof Blob)) { reject(new Error("恢复副本不完整")); return; }
            const record = item.result;
            if (record.analysis) record.analysis.labels = unpackLabels(record.analysis.labels);
            images[index] = { ...record, original: original.result, undo: [] };
            if (--pending === 0) resolve({ ...manifest, version: 1, images });
          };
        });
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
let lastWritten = new Map<string, ImageEntry>();
let lastOriginal = new Map<string, Blob>();
let writeQueue: Promise<void> = Promise.resolve();
export function recoveryPlan(images: ImageEntry[], previous: Map<string, ImageEntry>, originals: Map<string, Blob>, keys: IDBValidKey[]) {
  const ids = new Set(images.map(image => image.id));
  return {
    images: images.filter(image => previous.get(image.id) !== image),
    originals: images.filter(image => originals.get(image.id) !== image.original),
    remove: keys.filter(key => typeof key === "string" && (key.startsWith("image:") || key.startsWith("original:")) && !ids.has(key.slice(key.indexOf(":") + 1))),
  };
}
export function writeRecovery(
  images: ImageEntry[],
  items: PlateItem[],
  background: PlateBackground = "white",
  settings: PlateSettings = { ...DEFAULT_PLATE_SETTINGS },
): Promise<void> {
  const task = writeQueue.catch(() => {}).then(() => writeRecoveryNow(images, items, background, settings));
  writeQueue = task;
  return task;
}
async function writeRecoveryNow(images: ImageEntry[], items: PlateItem[], background: PlateBackground, settings: PlateSettings): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("snapshots", "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      const store = transaction.objectStore("snapshots");
      const request = store.getAllKeys();
      request.onsuccess = () => {
        const plan = recoveryPlan(images, lastWritten, lastOriginal, request.result);
        for (const image of plan.images) {
          const { data: _data, url: _url, original: _original, undo: _undo, ...record } = image;
          store.put({ ...record, analysis: record.analysis ? { ...record.analysis, labels: packLabels(record.analysis.labels) } : undefined }, `image:${image.id}`);
        }
        for (const image of plan.originals) store.put(image.original, `original:${image.id}`);
        for (const key of plan.remove) store.delete(key);
        store.put({ version: 2, date: new Date().toISOString(), imageIds: images.map(image => image.id), items, background, settings }, "manifest");
        store.delete("latest");
      };
    });
    lastWritten = new Map(images.map(image => [image.id, image]));
    lastOriginal = new Map(images.map(image => [image.id, image.original]));
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
