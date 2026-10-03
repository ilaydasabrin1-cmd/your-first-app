// Lokale IndexedDB-Persistenz für den Perlen-Manager (nur im Browser aufrufen).
const DB_NAME = "perlen-manager-db";
const DB_VERSION = 1;
export const STORES = ["beads", "scans", "boxes", "meta"] as const;
export type StoreName = (typeof STORES)[number];

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Rec = any;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        STORES.forEach((s) => {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "key" });
        });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

function req<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const r = fn(db.transaction(store, mode).objectStore(store));
        r.onsuccess = () => res(r.result as T);
        r.onerror = () => rej(r.error);
      }),
  );
}

export const getAll = (s: StoreName) => req<Rec[]>(s, "readonly", (o) => o.getAll());
export const put = (s: StoreName, obj: Rec) => req(s, "readwrite", (o) => o.put(obj));
export const del = (s: StoreName, key: string) => req(s, "readwrite", (o) => o.delete(key));
export const clearStore = (s: StoreName) => req(s, "readwrite", (o) => o.clear());

export async function initDB() {
  const meta = await getAll("meta");
  if (!meta.find((x) => x.key === "counters")) await put("meta", { key: "counters", bead: 0, scan: 0, box: 0 });
}

export async function nextId(prefix: "ID" | "SCAN" | "BOX") {
  await initDB();
  const c = (await getAll("meta")).find((x) => x.key === "counters")!;
  const k = prefix === "ID" ? "bead" : prefix === "SCAN" ? "scan" : "box";
  c[k]++;
  await put("meta", c);
  return prefix + "-" + String(c[k]).padStart(5, "0");
}

export const now = () => new Date().toISOString();

export function rgbToLab({ r, g, b }: { r: number; g: number; b: number }) {
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function deltaE(a: { L: number; a: number; b: number }, b: { L: number; a: number; b: number }) {
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

export async function analyzePixelColor(file: File) {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
  const max = 900;
  const scale = Math.min(1, max / img.width, max / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const can = document.createElement("canvas");
  can.width = w;
  can.height = h;
  const ctx = can.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  const d = ctx.getImageData(Math.floor(w * 0.2), Math.floor(h * 0.2), Math.max(1, Math.floor(w * 0.6)), Math.max(1, Math.floor(h * 0.6))).data;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 200) continue;
    rs.push(d[i]!); gs.push(d[i + 1]!); bs.push(d[i + 2]!);
  }
  if (!rs.length) throw Error("Keine analysierbaren Pixel.");
  const med = (a: number[]) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
  const r = med(rs), g = med(gs), b = med(bs);
  const hex = "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return {
    r, g, b, hex, confidence: 0.2,
    warning: "Rohmessung: Fach-, Perlen- und Lochmaske müssen vor einer endgültigen Farbbewertung geprüft werden.",
  };
}

export function download(name: string, type: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
