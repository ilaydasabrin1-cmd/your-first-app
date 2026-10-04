// Lokale IndexedDB-Persistenz für den Perlen-Manager (nur im Browser aufrufen).
const DB_NAME = "perlen-manager-db";
const DB_VERSION = 2;
export const STORES = ["beads", "scans", "boxes", "meta", "validations"] as const;
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

export type Pt = { x: number; y: number };
type RGB = { r: number; g: number; b: number };

/** Zähler nie unter die höchste vorhandene Nummer fallen lassen – IDs werden nie wiederverwendet. */
export async function syncCounters() {
  await initDB();
  const c = (await getAll("meta")).find((x) => x.key === "counters")!;
  const maxOf = (arr: Rec[], pre: string) => arr.reduce((m, x) => {
    const n = parseInt(String(x.key || "").replace(pre + "-", ""), 10); return isNaN(n) ? m : Math.max(m, n);
  }, 0);
  const [b, s, x] = await Promise.all([getAll("beads"), getAll("scans"), getAll("boxes")]);
  c.bead = Math.max(c.bead || 0, maxOf(b, "ID")); c.scan = Math.max(c.scan || 0, maxOf(s, "SCAN")); c.box = Math.max(c.box || 0, maxOf(x, "BOX"));
  await put("meta", c);
}

export const toHex = ({ r, g, b }: RGB) => "#" + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");

export function rgbToHsl({ r, g, b }: RGB) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0; const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) { h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360; }
  return { h, s, l };
}

export function rgbToOklab({ r, g, b }: RGB) {
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}

/** Vorläufige Farbgruppe aus dem Farbton (kein endgültiger Farbcode). */
export function colorFamily(rgb: RGB | null | undefined): string {
  if (!rgb) return "Ohne Farbe";
  const { h, s, l } = rgbToHsl(rgb);
  if (s < 0.15 || Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b) < 20) return l > 0.78 ? "Weiß" : l < 0.22 ? "Schwarz" : "Grau";
  if (h >= 15 && h < 45 && l < 0.4) return "Braun";
  if (h < 15 || h >= 345) return "Rot";
  if (h < 40) return "Orange";
  if (h < 70) return "Gelb";
  if (h < 160) return "Grün";
  if (h < 200) return "Türkis";
  if (h < 255) return "Blau";
  if (h < 290) return "Lila";
  return "Rosa";
}

/** Alle technischen Farbwerte aus einer gemessenen RGB-Farbe. */
export function colorMetrics(rgb: RGB) {
  const hsl = rgbToHsl(rgb), cielab = rgbToLab(rgb), oklab = rgbToOklab(rgb);
  return {
    hex: toHex(rgb), rgb, hsl: { h: +hsl.h.toFixed(1), s: +hsl.s.toFixed(3), l: +hsl.l.toFixed(3) },
    cielab, oklab, hue: +hsl.h.toFixed(1), chroma: +Math.hypot(cielab.a, cielab.b).toFixed(2), brightness: +cielab.L.toFixed(1),
  };
}

export type CellResult = {
  r: number; g: number; b: number; hex: string; confidence: number; warning: string | null;
  masks: { method: string; sampled: number; beadPixels: number; holePixels: number; reflectionPixels: number; analysisPixels: number };
};

/**
 * corners normalized 0..1 in order TL, TR, BR, BL. Pro Fach (row-major):
 * beadMask = runder Perlenbereich, holeMask = Mitte + deutlich dunklere Pixel (Loch),
 * Reflexionen werden entfernt; analysisMask = bead − hole − Reflexion. Nur analysisMask wird gemessen.
 */
export async function analyzeGrid(file: Blob, corners: Pt[], rows: number, cols: number): Promise<CellResult[]> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(Error("Foto konnte nicht geladen werden.")); im.src = url;
  });
  const max = 1600;
  const scale = Math.min(1, max / img.width, max / img.height);
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const can = document.createElement("canvas"); can.width = w; can.height = h;
  const ctx = can.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
  const data = ctx.getImageData(0, 0, w, h).data;
  const [tl, tr, br, bl] = corners as [Pt, Pt, Pt, Pt];
  const map = (u: number, v: number) => {
    const x = (1 - v) * ((1 - u) * tl.x + u * tr.x) + v * ((1 - u) * bl.x + u * br.x);
    const y = (1 - v) * ((1 - u) * tl.y + u * tr.y) + v * ((1 - u) * bl.y + u * br.y);
    return { x: x * w, y: y * h };
  };
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  const out: CellResult[] = [];
  const S = 24;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const px: { r: number; g: number; b: number; d: number }[] = [];
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
      const du = (j / (S - 1)) - 0.5, dv = (i / (S - 1)) - 0.5; // -0.5..0.5 im Fach
      const d = Math.hypot(du, dv);
      if (d > 0.36) continue; // beadMask: runder Bereich, Fachwände ausgeschlossen
      const p = map((c + 0.5 + du) / cols, (r + 0.5 + dv) / rows);
      const x = Math.min(w - 1, Math.max(0, Math.round(p.x))), y = Math.min(h - 1, Math.max(0, Math.round(p.y)));
      const k = (y * w + x) * 4;
      px.push({ r: data[k]!, g: data[k + 1]!, b: data[k + 2]!, d });
    }
    const L = px.map((p) => lum(p.r, p.g, p.b));
    const ringL = med(L.filter((_, i) => px[i]!.d > 0.14).concat([0]).slice(0, -1).length ? L.filter((_, i) => px[i]!.d > 0.14) : L);
    let hole = 0, refl = 0;
    const use = px.filter((p, i) => {
      const isHole = p.d < 0.1 || L[i]! < ringL * 0.55; // Lochmitte oder deutlich dunkler als Perlenring
      const isRefl = L[i]! > 245 || L[i]! > ringL * 1.6;
      if (isHole) hole++; else if (isRefl) refl++;
      return !isHole && !isRefl;
    });
    const sampled = px.length;
    const masks = { method: "geometric-v1", sampled, beadPixels: sampled, holePixels: hole, reflectionPixels: refl, analysisPixels: use.length };
    if (use.length < sampled * 0.2) {
      out.push({ r: 0, g: 0, b: 0, hex: "", confidence: 0, warning: "Zu wenige auswertbare Perlenpixel – Fach leer, Loch/Reflexion zu groß oder Raster verschoben.", masks });
      continue;
    }
    const R = med(use.map((p) => p.r)), G = med(use.map((p) => p.g)), B = med(use.map((p) => p.b));
    const ul = use.map((p) => lum(p.r, p.g, p.b)), mean = ul.reduce((a, b) => a + b, 0) / ul.length;
    const sd = Math.sqrt(ul.reduce((a, b) => a + (b - mean) ** 2, 0) / ul.length);
    const ratio = use.length / sampled;
    let conf = Math.max(0, Math.min(1, ratio * (1 - Math.min(1, sd / 80))));
    const ml = lum(R, G, B);
    const warns: string[] = [];
    if (ml > 235 || ml < 20) { conf = Math.min(conf, 0.35); warns.push("Sehr hell/dunkel – Reflexion oder Schatten möglich."); }
    if (sd > 40) warns.push("Ungleichmäßige Farbe im Fach (mehrere Farben/Effekt?).");
    if (ratio < 0.5) warns.push("Großer Teil des Fachs als Loch/Reflexion ausgeschlossen.");
    out.push({ r: R, g: G, b: B, hex: toHex({ r: R, g: G, b: B }), confidence: +conf.toFixed(2), warning: warns.join(" ") || null, masks });
  }
  return out;
}
