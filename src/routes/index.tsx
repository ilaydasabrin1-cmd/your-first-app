import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeGrid, type Pt, type CellResult, clearStore, colorFamily, colorMetrics, del, deltaE, download, getAll, initDB, nextId, now, put,
  rgbToLab, STORES, syncCounters, type Rec,
} from "@/lib/perlen-db";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Perlen-Manager – Farbanalyse & Bestand" },
      { name: "description", content: "Offline Perlen-Manager für Farbanalyse, Boxen und Inventarverwaltung – lokal im Browser." },
      { property: "og:title", content: "Perlen-Manager – Farbanalyse & Bestand" },
      { property: "og:description", content: "Offline Perlen-Manager für Farbanalyse, Boxen und Inventarverwaltung." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: App,
});

const ATTRS: Record<string, string[]> = {
  size: ["", "2 mm", "3 mm", "4 mm", "5 mm", "6 mm", "7 mm", "8 mm", "1 cm", "unbekannt"],
  surface: ["", "glänzend", "glatt", "facettiert", "matt", "satin"],
  effect: ["", "crackle", "opak", "marmoriert", "inneneinzug", "silbereinzug", "perlmut", "transparent", "irisierend", "metallic", "lustre"],
  shape: ["", "rund", "rocailles", "bicone", "rondell"],
  material: ["", "plastik", "glas", "kristallglas"],
  transparency: ["", "transparent", "opak", "transluzent", "kristallklar"],
};
const ATTR_LABEL: Record<string, string> = {
  size: "Größe", surface: "Oberfläche", effect: "Effekt", shape: "Form", material: "Material", transparency: "Transparenz",
};

const TABS = [
  ["dashboard", "Übersicht"], ["scan", "Foto analysieren"], ["inventory", "Bestand"],
  ["boxes", "Boxen"], ["sort", "Sortieren"], ["compare", "Vergleich"], ["data", "Daten"],
] as const;
type Tab = (typeof TABS)[number][0];

type Comp = {
  number: number; status: string; color: string | null; attrs: Record<string, string>;
  hex?: string; rgb?: { r: number; g: number; b: number }; confidence?: number; warning?: string; colorName?: string; saved?: boolean;
  masks?: CellResult["masks"];
};

function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [beads, setBeads] = useState<Rec[]>([]);
  const [boxes, setBoxes] = useState<Rec[]>([]);
  const [scans, setScans] = useState<Rec[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const [b, x, s] = await Promise.all([getAll("beads"), getAll("boxes"), getAll("scans")]);
    setBeads(b.map((x) => ({ ...(x.attrs || {}), ...x, shape: x.shape ?? x.attrs?.shape ?? x.form ?? x.attrs?.form ?? null })));
    setBoxes(x); setScans(s);
  }, []);

  useEffect(() => {
    initDB().then(syncCounters).then(reload).then(() => setReady(true));
  }, [reload]);

  const exportJson = async () => {
    const [b, x, s, m, v] = await Promise.all(STORES.map((st) => getAll(st)));
    // Fotos (Binärdaten) werden nicht ins JSON geschrieben, nur ihre Metadaten.
    const scansOut = s!.map(({ photo, ...rest }) => ({ ...rest, photoStored: !!photo }));
    download("perlen-backup.json", "application/json", JSON.stringify({ version: 2, exportedAt: now(), beads: b, boxes: x, scans: scansOut, meta: m, validations: v }, null, 2));
  };

  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Perlen-Manager</h1>
          <p className="text-muted-foreground">Offline · lokal · ohne KI-Pflicht</p>
        </div>
        <button className="pm-btn" onClick={exportJson}>JSON-Backup</button>
      </header>
      <nav className="mb-3 flex gap-2 overflow-x-auto pb-2">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); reload(); }}
            className={tab === k ? "pm-btn shrink-0 bg-card shadow-soft" : "pm-btn shrink-0"}>{l}</button>
        ))}
      </nav>
      {!ready ? <p className="text-muted-foreground">Lade lokale Daten …</p> : (
        <main className="grid gap-3">
          {tab === "dashboard" && <Dashboard beads={beads} boxes={boxes} scans={scans} />}
          {tab === "scan" && <Scan boxes={boxes} scans={scans} reload={reload} goBoxes={() => setTab("boxes")} />}
          {tab === "inventory" && <Inventory beads={beads} boxes={boxes} reload={reload} />}
          {tab === "boxes" && <Boxes boxes={boxes} beads={beads} reload={reload} />}
          {tab === "sort" && <Sort beads={beads} boxes={boxes} reload={reload} />}
          {tab === "compare" && <Compare beads={beads} />}
          {tab === "data" && <Data beads={beads} exportJson={exportJson} reload={reload} />}
        </main>
      )}
    </div>
  );
}

function Dashboard({ beads, boxes, scans }: { beads: Rec[]; boxes: Rec[]; scans: Rec[] }) {
  const open = beads.filter((b) => b.status !== "Gespeichert").length;
  const colors = new Map<string, number>();
  beads.forEach((b) => { const k = b.colorGroup || "Nicht bestimmt"; colors.set(k, (colors.get(k) || 0) + 1); });
  const kpis: [string, number][] = [
    ["Perlen", beads.length], ["Boxen", boxes.length],
    ["Fächer", boxes.reduce((n, b) => n + (b.compartmentCount || 0), 0)],
    ["Scans", scans.length], ["Unsicher", beads.filter((b) => b.status === "Unsicher").length], ["Offen", open],
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map(([a, v]) => (
          <div key={a} className="pm-card"><div className="text-muted-foreground">{a}</div><div className="font-display text-3xl font-bold">{v}</div></div>
        ))}
      </div>
      <div className="pm-card">
        <h2 className="mb-2 text-xl font-semibold">Offene Aufgaben</h2>
        {open ? <p>{open} Einträge benötigen noch eine Prüfung oder Speicherung.</p> : <p className="text-success">Keine offenen Einträge.</p>}
      </div>
      <div className="pm-card">
        <h2 className="mb-2 text-xl font-semibold">Zuletzt hinzugefügt</h2>
        {beads.length ? <div className="grid gap-1.5">
          {[...beads].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8).map((b) => (
            <div key={b.key} className="flex items-center gap-2 text-sm">
              <span className="inline-block size-5 rounded-full border" style={{ background: b.hex || "transparent" }} />
              <strong>{b.id}</strong><span className="text-muted-foreground">{b.scanId} · {b.colorGroup || "—"} · Sicherheit {b.confidence != null ? Math.round(b.confidence * 100) + " %" : "—"}</span>
            </div>))}
        </div> : <span className="text-muted-foreground">Noch keine Perlen gespeichert.</span>}
      </div>
      <div className="pm-card">
        <h2 className="mb-2 text-xl font-semibold">Analysequalität</h2>
        {beads.length ? <p>{beads.filter((b) => (b.confidence ?? 0) >= 0.6).length} sicher · {beads.filter((b) => b.confidence != null && b.confidence < 0.6).length} unsicher · {beads.filter((b) => b.confidence == null).length} ohne Messung</p>
          : <span className="text-muted-foreground">Noch keine Messungen.</span>}
      </div>
      <div className="pm-card">
        <h2 className="mb-2 text-xl font-semibold">Farbgruppen im Bestand</h2>
        {colors.size ? (
          <div className="flex flex-wrap gap-1.5">
            {[...colors].sort((a, b) => b[1] - a[1]).map(([c, n]) => <span key={c} className="pm-pill">{c} · {n}</span>)}
          </div>
        ) : <span className="text-muted-foreground">Noch keine Farbdaten.</span>}
      </div>
    </>
  );
}

function Scan({ boxes, scans, reload, goBoxes }: { boxes: Rec[]; scans: Rec[]; reload: () => Promise<void>; goBoxes: () => void }) {
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  const [scanKey, setScanKey] = useState<string | null>(null);
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(6);
  const [corners, setCorners] = useState<Pt[]>([]);
  const [box, setBox] = useState("");
  const [comps, setComps] = useState<Comp[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<Record<string, string>>({});
  const [prog, setProg] = useState(0);
  const [status, setStatus] = useState("Noch keine Analyse gestartet.");

  
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);

  const toggle = (i: number) => setSel((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const R = Math.max(1, Math.min(16, rows || 1)), C = Math.max(1, Math.min(16, cols || 1));
  const makeComps = () => {
    const n = R * C;
    const cs: Comp[] = Array.from({ length: n }, (_, i) => ({ number: i + 1, status: "Neu", color: null, attrs: {} }));
    setComps(cs); return cs;
  };

  const runAnalysis = async (base: Comp[], idx: Set<number>) => {
    if (!image) return setStatus("Bitte zuerst ein Foto auswählen.");
    if (corners.length < 4) return setStatus("Bitte zuerst die 4 Ecken der Box auf dem Foto antippen.");
    if (base.length !== R * C) return setStatus("Fächerzahl passt nicht zu Reihen × Spalten – bitte Scan starten.");
    setProg(10); setStatus("Lokale Messung läuft …");
    try {
      const res = await analyzeGrid(image.file, corners, R, C);
      setComps(base.map((x, i) => {
        if (!idx.has(i)) return x;
        const m = res[i]!;
        if (!m.hex) return { ...x, hex: undefined, rgb: undefined, confidence: 0, warning: m.warning ?? "", masks: m.masks, status: "Nicht erkannt" };
        return { ...x, hex: m.hex, rgb: { r: m.r, g: m.g, b: m.b }, confidence: m.confidence, warning: m.warning ?? "", masks: m.masks,
          status: m.confidence >= 0.6 ? "Analysiert" : "Unsicher" };
      }));
      setProg(100);
      setStatus(`${idx.size} Fach/Fächer gemessen. Bitte Farben prüfen und dann speichern.`);
    } catch (e) { setStatus("Analysefehler: " + (e as Error).message); setProg(0); }
  };

  const analyze = () => {
    const idx = sel.size ? sel : new Set(comps.map((_, i) => i));
    return runAnalysis(comps, idx);
  };
  const scanAll = () => {
    const cs = comps.length === R * C ? comps : makeComps();
    const all = new Set(cs.map((_, i) => i));
    setSel(new Set());
    return runAnalysis(cs, all);
  };

  const save = async () => {
    if (!comps.some((c) => c.hex)) return setStatus("Bitte zuerst einen Scan starten.");
    const sk = scanKey || (await nextId("SCAN"));
    setScanKey(sk);
    const b = box || null;
    if (!scans.some((x) => x.key === sk)) await put("scans", {
      key: sk, createdAt: now(), box: b, layout: { rows: R, cols: C }, corners,
      photo: image?.file ?? null, photoName: image?.file.name ?? null, photoType: image?.file.type ?? null, photoSize: image?.file.size ?? null,
      analysis: { method: "geometric-v1", note: "Bead-/Hole-/Analysis-Mask je Fach; Originalfoto unverändert." },
    });
    let saved = 0;
    for (const c of comps) {
      if (!c.hex || !c.rgb || c.saved) continue;
      const id = await nextId("ID");
      const m = colorMetrics(c.rgb!);
      const grp = colorFamily(c.rgb);
      await put("beads", {
        key: id, id, scanId: sk, createdAt: now(), updatedAt: now(),
        originalBox: b, originalCompartment: c.number, currentBox: b, currentCompartment: c.number,
        // 1. Farbe, 2. Farbgruppe (vorläufig, automatisch), 3. Farbname, dann Farbcode (System noch offen) und technische Werte
        color: grp, colorGroup: grp, colorGroupSource: "auto-hue-v1", colorName: null, colorCode: null,
        hex: m.hex, rgb: m.rgb, hsl: m.hsl, cielab: m.cielab, oklab: m.oklab, hue: m.hue, chroma: m.chroma, brightness: m.brightness,
        saturation: m.hsl.s, distribution: null, dominantRegions: null, fingerprint: null, deltaE00: null,
        confidence: c.confidence ?? null, analysisQuality: (c.confidence ?? 0) >= 0.6 ? "ok" : "unsicher",
        masks: c.masks ? { beadMask: c.masks.beadPixels, holeMask: c.masks.holePixels, reflectionMask: c.masks.reflectionPixels, analysisMask: c.masks.analysisPixels, sampled: c.masks.sampled, method: c.masks.method } : null,
        reflectionPercentage: c.masks ? +(c.masks.reflectionPixels / c.masks.sampled * 100).toFixed(1) : null,
        size: null, surface: null, effect: null, shape: null, material: null, transparency: null,
        ...c.attrs, status: c.status, warning: c.warning || null, manualChanges: [], history: [],
      });
      saved++;
    }
    setComps((cs) => cs.map((c) => (c.hex ? { ...c, saved: true } : c)));
    const prev = (await getAll("scans")).find((x) => x.key === sk) || { key: sk, createdAt: now() };
    await put("scans", { ...prev, updatedAt: now(), compartments: comps.map(({ saved: _s, ...c }) => c) });
    setStatus(`${saved} Perle(n) gespeichert. Eigenschaften kannst du später im Bestand zuweisen.`);
    reload();
  };

  const pick = (f: File) => {
    setImage({ file: f, url: URL.createObjectURL(f) }); setCorners(DEFAULT_CORNERS);
    setScanKey(null); setComps([]); setSel(new Set()); setProg(0);
    setStatus("Ziehe die 4 Ecken des Rasters auf die Ecken der Box.");
  };
  const deleteLastScan = async () => {
    const last = [...scans].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if (!last) return alert("Es gibt noch keinen gespeicherten Scan.");
    const own = (await getAll("beads")).filter((x) => x.scanId === last.key);
    if (!confirm(`Scan ${last.key} vom ${new Date(last.createdAt).toLocaleString("de-DE")} löschen?\n\nDabei werden die ${own.length} Perle(n) gelöscht, die aus diesem Scan stammen. Ältere Scans und alle anderen Perlen bleiben unverändert.`)) return;
    for (const x of own) await del("beads", x.key);
    await del("scans", last.key);
    if (scanKey === last.key) { setScanKey(null); setComps((cs) => cs.map((c) => ({ ...c, saved: false }))); }
    await reload(); setStatus(`Scan ${last.key} gelöscht.`);
  };
  const DEFAULT_CORNERS: Pt[] = [{ x: 0.12, y: 0.12 }, { x: 0.88, y: 0.12 }, { x: 0.88, y: 0.88 }, { x: 0.12, y: 0.88 }];
  const frameRef = useRef<HTMLDivElement>(null);
  const dragIdx = useRef<number | null>(null);
  const moveCorner = (e: React.PointerEvent) => {
    const i = dragIdx.current; const el = frameRef.current;
    if (i === null || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setCorners((cs) => cs.map((p, k) => (k === i ? { x, y } : p)));
  };

  return (
    <>
      <div className="pm-card grid gap-3">
        <h2 className="text-xl font-semibold">Foto auswählen</h2>
        <p className="text-muted-foreground">Originalfoto bleibt unverändert. Die lokale Analyse erzeugt keine erfundenen Messwerte.</p>
        <div className="flex flex-wrap gap-2">
          <label className="pm-btn">Vorhandenes Foto auswählen
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
          </label>
          <label className="pm-btn">Foto aufnehmen
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
          </label>
          <button className="pm-btn" onClick={() => {
            if (comps.some((c) => c.hex && !c.saved) && !confirm("Ungespeicherte Analyse verwerfen? Gespeicherte Perlen bleiben erhalten.")) return;
            setImage(null); setScanKey(null); setComps([]); setSel(new Set()); setProg(0); setCorners([]);
            setStatus("Neues Foto: Bitte ein Foto auswählen. Gespeicherte Perlen bleiben erhalten.");
          }}>Neues Foto</button>
          <button className="pm-btn text-destructive" onClick={deleteLastScan}>Letzten Scan löschen</button>
        </div>
        {!image && <div className="rounded-xl bg-secondary p-6 text-center text-muted-foreground">Noch kein Foto ausgewählt.</div>}
        {image && <>
          <p className="text-sm font-medium">Ziehe die 4 Eckpunkte auf die Ecken der Box – das Raster passt sich an.</p>
          <div ref={frameRef} className="relative mx-auto w-fit touch-none select-none"
            onPointerMove={moveCorner} onPointerUp={() => (dragIdx.current = null)} onPointerCancel={() => (dragIdx.current = null)}>
            <img src={image.url} alt="Originalfoto" draggable={false} className="block max-h-[70vh] max-w-full rounded-xl bg-secondary" />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              {corners.length === 4 && gridLines(corners, rows, cols).map((l, i) => (
                <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke="var(--primary)" vectorEffect="non-scaling-stroke" style={{ strokeWidth: 1.5 }} />
              ))}
              {corners.length === 4 && <polygon fill="none" stroke="var(--primary)" style={{ strokeWidth: 2.5 }} vectorEffect="non-scaling-stroke"
                points={corners.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} />}
            </svg>
            {corners.map((p, i) => (
              <span key={i}
                onPointerDown={(e) => { e.preventDefault(); dragIdx.current = i; frameRef.current?.setPointerCapture(e.pointerId); }}
                className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-background bg-primary/80 text-xs font-bold text-primary-foreground shadow active:cursor-grabbing"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}>{i + 1}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="pm-btn" onClick={() => setCorners(DEFAULT_CORNERS)}>Raster zurücksetzen</button>
          </div>
          <p className="text-muted-foreground">{image.file.name} · {Math.round(image.file.size / 1024)} KB</p>
        </>}
      </div>

      <div className="pm-card grid gap-3">
        <h2 className="text-xl font-semibold">Box-Aufteilung</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="pm-label">Reihen
            <input className="pm-field" type="number" min={1} max={16} value={rows} onChange={(e) => setRows(+e.target.value)} />
          </label>
          <label className="pm-label">Spalten
            <input className="pm-field" type="number" min={1} max={16} value={cols} onChange={(e) => setCols(+e.target.value)} />
          </label>
          <label className="pm-label">Box (optional)
            <select className="pm-field" value={box} onChange={(e) => setBox(e.target.value)}>
              <option value="">Ohne Box</option>
              {boxes.map((b) => <option key={b.key} value={b.key}>{b.name} ({b.key})</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{Math.max(1, rows || 1) * Math.max(1, cols || 1)} Fächer. Das Raster wird zwischen den 4 Ecken aufgespannt.</p>
        <div className="flex flex-wrap gap-2">
          <button className="pm-btn-primary" onClick={scanAll}>Scan starten (alle Fächer analysieren)</button>
          <button className="pm-btn-primary" onClick={save} disabled={!comps.some((c) => c.hex)}>Perlen speichern</button>
          <button className="pm-btn" onClick={() => { makeComps(); setSel(new Set()); }}>Nur Fächer erzeugen</button>
        </div>
        <p className="text-sm text-muted-foreground">{status}</p>
        {!boxes.length && <button className="w-fit text-xs underline text-muted-foreground" onClick={goBoxes}>Box anlegen (optional)</button>}
      </div>


      <div className="pm-card grid gap-3">
        <div className="sticky top-0 z-10 flex items-center justify-between bg-card"><h2 className="text-xl font-semibold">Fächer</h2><span className="pm-pill">{sel.size} ausgewählt</span></div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
          {comps.map((c, i) => (
            <button key={i} onClick={() => toggle(i)}
              className={`min-h-26 rounded-xl border bg-card p-2.5 text-left ${sel.has(i) ? "outline-3 outline-primary" : ""}`}>
              <strong>Fach {c.number}</strong>
              <div className="my-1.5 h-9 rounded-lg bg-muted" style={c.hex ? { background: c.hex } : undefined} />
              <span className="text-xs">{c.hex ? `${colorFamily(c.rgb)} · ${c.hex}` : c.status === "Nicht erkannt" ? "Nicht erkannt" : "Noch nicht analysiert"}</span>
              <div className="text-xs text-muted-foreground">{c.status}{c.confidence != null && c.hex ? ` · ${Math.round(c.confidence * 100)} %` : ""}{c.saved ? " · gespeichert" : ""}</div>
              {c.masks && <div className="text-[10px] text-muted-foreground">Loch {Math.round(c.masks.holePixels / c.masks.sampled * 100)} % ausgeschlossen</div>}
              {c.warning && <div className="text-[10px] text-destructive">{c.warning}</div>}
            </button>
          ))}
          {!comps.length && <p className="text-muted-foreground">Noch keine Fächer erzeugt.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="pm-btn" onClick={() => setSel(new Set(comps.map((_, i) => i)))}>Alle</button>
          <button className="pm-btn" onClick={() => setSel(new Set())}>Keine</button>
          <button className="pm-btn" onClick={() => setSel(new Set(comps.map((_, i) => i).filter((i) => !sel.has(i))))}>Umkehren</button>
        </div>
      </div>

      <div className="pm-card grid gap-3">
        <h2 className="text-xl font-semibold">Eigenschaften für Auswahl</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(ATTRS).map(([k, vals]) => (
            <label key={k} className="pm-label">{ATTR_LABEL[k]}
              <select className="pm-field" value={bulk[k] || ""} onChange={(e) => setBulk({ ...bulk, [k]: e.target.value })}>
                {vals.map((v) => <option key={v} value={v}>{v || "Nicht ändern"}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div><button className="pm-btn" onClick={() => {
          const ch = Object.fromEntries(Object.entries(bulk).filter(([, v]) => v));
          if (!sel.size) return setStatus("Bitte zuerst Fächer auswählen.");
          setComps((cs) => cs.map((c, i) => sel.has(i) ? { ...c, attrs: { ...c.attrs, ...ch } } : c));
          setStatus(`${Object.keys(ch).length} Eigenschaft(en) auf ${sel.size} Fächer angewendet. Auswahl bleibt bestehen.`);
        }}>Auf {sel.size} ausgewählte anwenden</button></div>
        <p className="text-xs text-muted-foreground">Nur gewählte Felder werden geändert, andere Eigenschaften bleiben erhalten. Bereits gespeicherte Perlen bearbeitest du im Bestand.</p>
      </div>

      <div className="pm-card grid gap-3">
        <h2 className="text-xl font-semibold">Analyse</h2>
        <div className="h-2.5 overflow-hidden rounded-full bg-secondary"><i className="block h-full bg-primary transition-all" style={{ width: prog + "%" }} /></div>
        <p className="text-muted-foreground">{status}</p>
        <div className="flex flex-wrap gap-2">
          <button className="pm-btn-primary" onClick={analyze}>Ausgewählte Fächer analysieren</button>
          <button className="pm-btn" onClick={save}>Analysierte Fächer speichern</button>
        </div>
      </div>
    </>
  );
}

function Inventory({ beads, boxes, reload }: { beads: Rec[]; boxes: Rec[]; reload: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [st, setSt] = useState("");
  const [detail, setDetail] = useState<Rec | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dupes, setDupes] = useState<{ a: Rec; b: Rec; dE: number; attrs: string[] }[] | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (detail) dlg.current?.showModal(); }, [detail]);
  const [f, setF] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const boxName = (k: string | null) => (k ? boxes.find((x) => x.key === k)?.name || k : "Ohne Box");
  const FILTERS: [string, string, string[]][] = [
    ["colorGroup", "Farbgruppe", [...new Set(beads.map((b) => b.colorGroup).filter(Boolean))]],
    ...Object.entries(ATTRS).map(([k, v]) => [k, ATTR_LABEL[k]!, [...v.filter(Boolean), "__none"]] as [string, string, string[]]),
    ["currentBox", "Aktuelle Box", ["__none", ...boxes.map((b) => b.key)]],
    ["originalBox", "Ursprüngliche Box", ["__none", ...boxes.map((b) => b.key)]],
  ];
  const num = (k: string) => (f[k] === undefined || f[k] === "" ? null : +f[k]!);
  const arr = beads.filter((b) => {
    if (q && !JSON.stringify(b).toLowerCase().includes(q.toLowerCase())) return false;
    if (st && b.status !== st) return false;
    for (const [k] of FILTERS) {
      const v = f[k]; if (!v) continue;
      if (v === "__none" ? b[k] : b[k] !== v) return false;
    }
    if (num("curComp") !== null && b.currentCompartment !== num("curComp")) return false;
    if (num("origComp") !== null && b.originalCompartment !== num("origComp")) return false;
    if (num("confMin") !== null && (b.confidence ?? -1) * 100 < num("confMin")!) return false;
    if (num("brMin") !== null && (b.brightness ?? -1) < num("brMin")!) return false;
    if (num("brMax") !== null && (b.brightness ?? 999) > num("brMax")!) return false;
    return true;
  });
  const applyBulk = async () => {
    const ch = Object.fromEntries(Object.entries(bulk).filter(([, v]) => v));
    if (!sel.size) return setMsg("Bitte zuerst Perlen auswählen.");
    if (!Object.keys(ch).length) return setMsg("Bitte mindestens eine Eigenschaft oder einen Standort wählen.");
    const { box: nb, comp: nc, ...attrs } = ch;
    for (const b of beads.filter((x) => sel.has(x.key))) {
      const changes = Object.entries(attrs).filter(([k, v]) => b[k] !== v).map(([k, v]) => ({ field: k, from: b[k] ?? null, to: v, at: now() }));
      const rec: Rec = { ...b, ...attrs, updatedAt: now(), manualChanges: [...(b.manualChanges || []), ...changes] };
      if (nb !== undefined) { rec.currentBox = nb === "__none" ? null : nb; rec.currentCompartment = nc ? +nc : rec.currentCompartment; }
      else if (nc) rec.currentCompartment = +nc;
      if (changes.length) rec.status = "Manuell korrigiert";
      await put("beads", rec);
    }
    await reload(); setMsg(`${sel.size} Perle(n) aktualisiert. Auswahl bleibt bestehen; andere Eigenschaften unverändert.`);
  };
  const allSel = arr.length > 0 && arr.every((b) => sel.has(b.key));
  const toggleAll = () => setSel(allSel ? new Set() : new Set(arr.map((b) => b.key)));
  const toggle = (k: string) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const checkDupes = () => {
    const list = beads.filter((b) => sel.has(b.key) && b.rgb);
    const lab = new Map(list.map((b) => [b.key, rgbToLab(b.rgb)]));
    const found: { a: Rec; b: Rec; dE: number; attrs: string[] }[] = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.scanId && b.scanId && a.scanId === b.scanId) continue;
      // Farb-Übereinstimmung ...
      const dE = deltaE(lab.get(a.key)!, lab.get(b.key)!);
      if (dE > 8) continue;
      // ... plus Eigenschaften: gesetzt u. verschieden = kein Duplikat;
      // Eigenschaften, die nur bei einer Perle gesetzt sind, werden als offen gemeldet.
      const shared: string[] = [], open: string[] = [];
      let conflict = false;
      for (const k of Object.keys(ATTRS)) {
        const av = a[k] || "", bv = b[k] || "";
        if (av && bv && av !== bv) { conflict = true; break; }
        if (av && bv) shared.push(`${ATTR_LABEL[k]}: ${av}`);
        else if (av || bv) open.push(`${ATTR_LABEL[k]}: ${av || bv} (nur ${av ? a.id : b.id})`);
      }
      if (conflict) continue;
      found.push({ a, b, dE, attrs: [...shared, ...open] });
    }
    found.sort((x, y) => x.dE - y.dE);
    setDupes(found);
    const vk = "VAL-" + Date.now();
    put("validations", { key: vk, type: "duplicate-check", method: "ΔE76≤8 + Eigenschaften", createdAt: now(), checked: list.map((b) => b.id),
      matches: found.map((m) => ({ a: m.a.id, b: m.b.id, deltaE76: +m.dE.toFixed(2), attrs: m.attrs })) });
  };
  return (
    <div className="pm-card grid gap-3">
      <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Bestand</h2><span className="pm-pill">{arr.length} / {beads.length}</span></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="pm-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID, Farbe, Farbgruppe, Farbname, Farbcode, Box, Fach ..." />
        <select className="pm-field" value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">Alle Status</option>
          {["Unsicher", "Analysiert", "Nicht erkannt", "Manuell korrigiert", "Geprüft"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <details className="rounded-xl bg-secondary/50 p-3">
        <summary className="cursor-pointer font-semibold">Filter {Object.values(f).filter(Boolean).length ? `(${Object.values(f).filter(Boolean).length} aktiv)` : ""}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FILTERS.map(([k, label, opts]) => (
            <label key={k} className="pm-label">{label}
              <select className="pm-field" value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                <option value="">Alle</option>
                {opts.map((o) => <option key={o} value={o}>{o === "__none" ? "nicht gesetzt" : k.endsWith("Box") ? boxName(o) : o}</option>)}
              </select>
            </label>
          ))}
          {([["curComp", "Aktuelles Fach"], ["origComp", "Ursprüngliches Fach"], ["confMin", "Sicherheit ab (%)"], ["brMin", "Helligkeit ab (L 0–100)"], ["brMax", "Helligkeit bis (L 0–100)"]] as const).map(([k, l]) => (
            <label key={k} className="pm-label">{l}<input className="pm-field" type="number" inputMode="numeric" value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
          ))}
        </div>
        <button className="pm-btn mt-3" onClick={() => setF({})}>Filter zurücksetzen</button>
      </details>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-card py-2">
        <span className="pm-pill text-sm font-semibold">{sel.size} ausgewählt</span>
        <button className="pm-btn" onClick={() => setSel(new Set([...sel, ...arr.map((b) => b.key)]))}>Gefilterte auswählen</button>
        <button className="pm-btn" onClick={() => setSel(new Set())}>Keine</button>
        <button className="pm-btn" onClick={() => setSel(new Set(arr.filter((b) => !sel.has(b.key)).map((b) => b.key)))}>Umkehren</button>
        <button className="pm-btn-primary" disabled={sel.size < 2} onClick={checkDupes}>Duplikate prüfen ({sel.size} ausgewählt)</button>
      </div>
      {sel.size > 0 && (
        <div className="grid gap-3 rounded-xl bg-secondary p-3">
          <h3 className="font-semibold">Auswahl bearbeiten ({sel.size})</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(ATTRS).map(([k, vals]) => (
              <label key={k} className="pm-label">{ATTR_LABEL[k]}
                <select className="pm-field" value={bulk[k] || ""} onChange={(e) => setBulk({ ...bulk, [k]: e.target.value })}>
                  {vals.map((v) => <option key={v} value={v}>{v || "Nicht ändern"}</option>)}
                </select>
              </label>
            ))}
            <label className="pm-label">Aktuelle Box
              <select className="pm-field" value={bulk.box || ""} onChange={(e) => setBulk({ ...bulk, box: e.target.value })}>
                <option value="">Nicht ändern</option><option value="__none">Ohne Box</option>
                {boxes.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
              </select>
            </label>
            <label className="pm-label">Aktuelles Fach<input className="pm-field" type="number" min={1} value={bulk.comp || ""} placeholder="Nicht ändern" onChange={(e) => setBulk({ ...bulk, comp: e.target.value })} /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="pm-btn-primary" onClick={applyBulk}>Auf {sel.size} ausgewählte anwenden</button>
            <button className="pm-btn" onClick={() => setBulk({})}>Felder leeren</button>
          </div>
          <p className="text-xs text-muted-foreground">Der Originalstandort bleibt immer unverändert.</p>
        </div>
      )}
      {msg && <p className="text-sm">{msg}</p>}
      {dupes !== null && (
        <div className="grid gap-2 rounded-xl bg-secondary p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Duplikate: {dupes.length ? `${dupes.length} mögliche Übereinstimmung(en) in verschiedenen Scans` : "keine gefunden"}</h3>
            <button className="pm-btn" onClick={() => setDupes(null)}>Schließen</button>
          </div>
          {dupes.map(({ a, b, dE, attrs }, i) => (
            <div key={i} className="grid gap-1 rounded-lg bg-card p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-block size-4 rounded-full border" style={{ background: a.hex || "#ccc" }} />
                <strong>{a.id}</strong><span className="text-muted-foreground">({a.scanId || "kein Scan"})</span>
                <span>≈</span>
                <span className="inline-block size-4 rounded-full border" style={{ background: b.hex || "#ccc" }} />
                <strong>{b.id}</strong><span className="text-muted-foreground">({b.scanId || "kein Scan"})</span>
                <span className="pm-pill">ΔE {dE.toFixed(1)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                {attrs.length ? <>Eigenschaften: {attrs.join(" · ")}</> : "Eigenschaften: keine gesetzt"}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:hidden">
        {arr.map((b) => (
          <div key={b.key} className={`flex items-center gap-3 rounded-xl border p-3 ${sel.has(b.key) ? "outline-2 outline-primary" : ""}`}>
            <input type="checkbox" className="size-6" checked={sel.has(b.key)} onChange={() => toggle(b.key)} aria-label={`Perle ${b.id} auswählen`} />
            <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setDetail(b)}>
              <span className="inline-block size-9 shrink-0 rounded-full border" style={{ background: b.hex || "transparent" }} />
              <span className="grid text-sm">
                <strong>{b.id} <span className="font-normal text-muted-foreground">{b.scanId}</span></strong>
                <span>{b.colorGroup || "—"} · {b.hex || "—"} · {b.confidence != null ? Math.round(b.confidence * 100) + " %" : "—"}</span>
                <span className="text-xs text-muted-foreground">{[b.size, b.surface, b.effect, b.shape, b.material, b.transparency].filter(Boolean).join(" · ") || "keine Eigenschaften"}</span>
                <span className="text-xs text-muted-foreground">Jetzt: {boxName(b.currentBox)} F{b.currentCompartment ?? "–"} · Original: {boxName(b.originalBox)} F{b.originalCompartment ?? "–"}</span>
              </span>
            </button>
          </div>
        ))}
        {!arr.length && <p className="text-muted-foreground">Keine Einträge.</p>}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left">{["", "ID", "Farbe", "Farbgruppe", "Farbname", "Farbcode", "Größe", "Oberfläche", "Effekt", "Form", "Material", "Transparenz", "Sicherheit", "Aktuell", "Original", "Status"].map((h, i) => <th key={i} className="border-b p-2.5">{i === 0 ? <input type="checkbox" checked={allSel} onChange={toggleAll} aria-label="Alle auswählen" /> : h}</th>)}</tr></thead>
          <tbody>
            {arr.map((b) => (
              <tr key={b.key} onClick={() => setDetail(b)} className="cursor-pointer hover:bg-muted">
                <td className="border-b p-2.5" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={sel.has(b.key)} onChange={() => toggle(b.key)} aria-label={`Perle ${b.id} auswählen`} />
                </td>
                <td className="border-b p-2.5"><strong>{b.id}</strong><div className="text-xs">{b.scanId}</div></td>
                <td className="border-b p-2.5"><span className="inline-flex items-center gap-1.5">
                  {b.hex && <span className="inline-block size-4 rounded-full border" style={{ background: b.hex }} />}{b.color || "—"} {b.hex && <span className="pm-pill">{b.hex}</span>}</span></td>
                <td className="border-b p-2.5">{b.colorGroup || "—"}</td>
                <td className="border-b p-2.5">{b.colorName || "—"}</td>
                <td className="border-b p-2.5">{b.colorCode || "—"}</td>
                {["size", "surface", "effect", "shape", "material", "transparency"].map((k) => <td key={k} className="border-b p-2.5">{b[k] || "—"}</td>)}
                <td className="border-b p-2.5">{b.confidence != null ? Math.round(b.confidence * 100) + " %" : "—"}</td>
                <td className="border-b p-2.5">{boxName(b.currentBox)} · F{b.currentCompartment ?? "—"}</td>
                <td className="border-b p-2.5">{boxName(b.originalBox)} · F{b.originalCompartment ?? "—"}</td>
                <td className="border-b p-2.5"><span className="pm-pill">{b.status}</span></td>
              </tr>
            ))}
            {!arr.length && <tr><td colSpan={16} className="p-2.5 text-muted-foreground">Keine Einträge.</td></tr>}
          </tbody>
        </table>
      </div>
      <dialog ref={dlg} onClose={() => setDetail(null)} className="m-auto w-[calc(100%-28px)] max-w-2xl rounded-2xl border-0 bg-card p-5 text-card-foreground shadow-soft backdrop:bg-primary/35">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">Bestandsdetails</h2><button className="pm-btn" onClick={() => dlg.current?.close()}>Schließen</button></div>
        {detail && <>
          <div className="mb-4 grid gap-3 rounded-xl bg-secondary p-3">
            <h3 className="font-semibold">Eigenschaften zuweisen</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(ATTRS).map(([k, vals]) => (
                <label key={k} className="pm-label">{ATTR_LABEL[k]}
                  <select className="pm-field" value={detail[k] || ""} onChange={(e) => setDetail({ ...detail, [k]: e.target.value || null })}>
                    {vals.map((v) => <option key={v} value={v}>{v || "—"}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div><button className="pm-btn-primary" onClick={async () => {
              const orig = beads.find((x) => x.key === detail.key) || {};
              const changes = Object.keys(ATTRS).filter((k) => (orig[k] ?? null) !== (detail[k] ?? null)).map((k) => ({ field: k, from: orig[k] ?? null, to: detail[k] ?? null, at: now() }));
              const rec = { ...detail, status: changes.length ? "Manuell korrigiert" : detail.status, updatedAt: now(), manualChanges: [...(detail.manualChanges || []), ...changes] };
              await put("beads", rec); setDetail(rec); await reload(); dlg.current?.close();
            }}>Eigenschaften speichern</button></div>
          </div>
          <dl className="grid gap-1 text-sm">
            {Object.entries(detail).filter(([k]) => !["history", "manualChanges"].includes(k)).map(([k, v]) => (
              <div key={k}><dt className="font-semibold">{k}</dt><dd className="break-all text-muted-foreground">{v !== null && typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}</dd></div>
            ))}
          </dl>
        </>}
      </dialog>
    </div>
  );
}

function Boxes({ boxes, beads, reload }: { boxes: Rec[]; beads: Rec[]; reload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [n, setN] = useState(12);
  return (
    <>
      <div className="pm-card grid gap-3">
        <h2 className="text-xl font-semibold">Boxen</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="pm-label">Neue Box<input className="pm-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Box Perlen 01" /></label>
          <label className="pm-label">Fächer<input className="pm-field" type="number" min={1} max={256} value={n} onChange={(e) => setN(+e.target.value)} /></label>
        </div>
        <div><button className="pm-btn-primary" onClick={async () => {
          const key = await nextId("BOX");
          await put("boxes", { key, name: name.trim() || "Box", compartmentCount: Math.max(1, Math.min(256, n || 1)), createdAt: now() });
          setName(""); reload();
        }}>Box erstellen</button></div>
      </div>
      <div className="grid gap-2">
        {boxes.map((b) => (
          <div key={b.key} className="pm-card grid gap-2">
            <div className="flex items-center justify-between"><strong>{b.name}</strong><span className="pm-pill">{b.key}</span></div>
            <div>{b.compartmentCount} Fächer</div>
            <div><button className="pm-btn text-destructive" onClick={async () => {
              if (beads.some((x) => x.currentBox === b.key || x.originalBox === b.key))
                return alert("Diese Box wird von Beständen verwendet und kann nicht gelöscht werden, ohne zuerst die Standorte zu ändern.");
              if (confirm("Box wirklich löschen?")) { await del("boxes", b.key); reload(); }
            }}>Box löschen</button></div>
          </div>
        ))}
        {!boxes.length && <p className="text-muted-foreground">Noch keine Box.</p>}
      </div>
    </>
  );
}

const COLOR_ORDER = ["Rot", "Orange", "Gelb", "Grün", "Türkis", "Blau", "Lila", "Rosa", "Braun", "Weiß", "Grau", "Schwarz", "Ohne Farbe"];

const SORT_CRITERIA: Record<string, string> = {
  color: "Farbe", surface: "Oberfläche", size: "Größe", effect: "Effekt", shape: "Form", material: "Material", transparency: "Transparenz",
};

type SortGroup = { label: string; beads: Rec[] };
type SortPlan = { boxKey: string; boxName: string; slots: { comp: number; group: SortGroup }[]; overflow: SortGroup[] };

function Sort({ beads, boxes, reload }: { beads: Rec[]; boxes: Rec[]; reload: () => Promise<void> }) {
  const [criteria, setCriteria] = useState<string[]>(["color"]);
  const [boxSel, setBoxSel] = useState<Set<string>>(new Set());
  const [onlyUnsorted, setOnlyUnsorted] = useState(false);
  const [plan, setPlan] = useState<SortPlan[] | null>(null);
  const [manual, setManual] = useState<Record<string, { box: string; comp: string }>>({});

  const assignBead = async (b: Rec) => {
    const m = manual[b.key];
    if (!m?.box) return alert("Bitte zuerst eine Box wählen.");
    const box = boxes.find((x) => x.key === m.box);
    const comp = Math.max(1, Math.min(box?.compartmentCount || 1, parseInt(m.comp) || 1));
    await put("beads", { ...b, currentBox: m.box, currentCompartment: comp, updatedAt: now() });
    await reload();
  };

  const toggleCrit = (k: string) =>
    setCriteria((cs) => (cs.includes(k) ? cs.filter((c) => c !== k) : [...cs, k]));
  const moveCrit = (k: string, dir: -1 | 1) =>
    setCriteria((cs) => {
      const i = cs.indexOf(k), j = i + dir;
      if (i < 0 || j < 0 || j >= cs.length) return cs;
      const n = [...cs];[n[i], n[j]] = [n[j]!, n[i]!]; return n;
    });

  const keyOf = (b: Rec) =>
    criteria.map((c) => (c === "color" ? colorFamily(b.rgb) : String(b[c] || "ohne " + SORT_CRITERIA[c]))).join(" · ");

  const groupRank = (label: string) => {
    const fam = label.split(" · ")[0]!;
    const i = COLOR_ORDER.indexOf(fam);
    return i < 0 ? COLOR_ORDER.length : i;
  };

  const buildPlan = () => {
    if (!criteria.length) return alert("Bitte mindestens ein Sortierkriterium wählen.");
    const targetBoxes = boxes.filter((b) => !boxSel.size || boxSel.has(b.key));
    if (!targetBoxes.length) return alert("Bitte mindestens eine Box anlegen bzw. auswählen.");
    const pool = beads.filter((b) => !onlyUnsorted || !b.currentBox);
    if (!pool.length) return alert("Keine Perlen zum Sortieren gefunden.");
    const map = new Map<string, Rec[]>();
    for (const b of pool) {
      const k = keyOf(b);
      map.set(k, [...(map.get(k) || []), b]);
    }
    const groups: SortGroup[] = [...map.entries()]
      .map(([label, bs]) => ({ label, beads: bs }))
      .sort((a, b) => groupRank(a.label) - groupRank(b.label) || a.label.localeCompare(b.label, "de"));
    const plans: SortPlan[] = [];
    let gi = 0;
    for (const box of targetBoxes) {
      const slots: SortPlan["slots"] = [];
      const cap = Math.max(1, box.compartmentCount || 1);
      for (let comp = 1; comp <= cap && gi < groups.length; comp++, gi++)
        slots.push({ comp, group: groups[gi]! });
      plans.push({ boxKey: box.key, boxName: box.name, slots, overflow: [] });
    }
    if (gi < groups.length) plans[plans.length - 1]!.overflow = groups.slice(gi);
    setPlan(plans);
  };

  const applyPlan = async () => {
    if (!plan) return;
    const total = plan.reduce((n, p) => n + p.slots.length, 0);
    if (!confirm(`Sortierung übernehmen? ${total} Gruppe(n) werden den Boxen zugewiesen und die Standorte der Perlen aktualisiert.`)) return;
    let moved = 0;
    for (const p of plan)
      for (const s of p.slots)
        for (const b of s.group.beads) {
          await put("beads", { ...b, currentBox: p.boxKey, currentCompartment: s.comp, updatedAt: now() });
          moved++;
        }
    await reload();
    alert(`${moved} Perle(n) wurden zugeordnet.`);
  };

  return (
    <>
      <div className="pm-card grid gap-3">
        <h2 className="text-xl font-semibold">Sortierkriterien</h2>
        <div className="grid gap-2">
          {Object.entries(SORT_CRITERIA).map(([k, label]) => {
            const pos = criteria.indexOf(k);
            return (
              <div key={k} className="flex items-center gap-2">
                <label className="flex flex-1 items-center gap-2">
                  <input type="checkbox" checked={pos >= 0} onChange={() => toggleCrit(k)} />
                  <span>{label}</span>
                  {pos >= 0 && <span className="pm-pill">{pos + 1}.</span>}
                </label>
                {pos >= 0 && (
                  <span className="flex gap-1">
                    <button className="pm-btn" onClick={() => moveCrit(k, -1)} aria-label="Nach oben">↑</button>
                    <button className="pm-btn" onClick={() => moveCrit(k, 1)} aria-label="Nach unten">↓</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyUnsorted} onChange={(e) => setOnlyUnsorted(e.target.checked)} />
          Nur Perlen ohne Box einsortieren
        </label>
      </div>

      <div className="pm-card grid gap-3">
        <h2 className="text-xl font-semibold">Ziel-Boxen</h2>
        <div className="flex flex-wrap gap-2">
          {boxes.map((b) => (
            <label key={b.key} className="pm-pill flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={boxSel.has(b.key)} onChange={() =>
                setBoxSel((s) => { const n = new Set(s); n.has(b.key) ? n.delete(b.key) : n.add(b.key); return n; })} />
              {b.name} ({b.compartmentCount} Fächer)
            </label>
          ))}
          {!boxes.length && <p className="text-muted-foreground">Noch keine Boxen – lege sie im Tab „Boxen" an.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="pm-btn-primary" onClick={buildPlan}>Sortierplan erstellen</button>
          {plan && <button className="pm-btn" onClick={applyPlan}>Sortierung übernehmen (Standorte speichern)</button>}
        </div>
      </div>

      <div className="pm-card grid gap-3">
        <h2 className="text-xl font-semibold">Manuell sortieren</h2>
        {!beads.length && <p className="text-muted-foreground">Noch keine Perlen im Bestand.</p>}
        <div className="grid gap-2">
          {beads.map((b) => {
            const m = manual[b.key] || { box: "", comp: "" };
            const box = boxes.find((x) => x.key === m.box);
            return (
              <div key={b.key} className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2.5 text-sm">
                <span className="inline-block size-5 rounded-full border" style={{ background: b.hex || "#ccc" }} />
                <strong>{b.id}</strong>
                <span className="text-muted-foreground">
                  {b.currentBox ? `${boxes.find((x) => x.key === b.currentBox)?.name || b.currentBox}, Fach ${b.currentCompartment || "–"}` : "ohne Box"}
                </span>
                <select
                  className="pm-field"
                  value={m.box}
                  onChange={(e) => setManual((s) => ({ ...s, [b.key]: { box: e.target.value, comp: "" } }))}
                >
                  <option value="">Box wählen…</option>
                  {boxes.map((x) => (
                    <option key={x.key} value={x.key}>{x.name}</option>
                  ))}
                </select>
                <select
                  className="pm-field"
                  value={m.comp}
                  disabled={!box}
                  onChange={(e) => setManual((s) => ({ ...s, [b.key]: { ...m, comp: e.target.value } }))}
                >
                  <option value="">Fach…</option>
                  {box && Array.from({ length: box.compartmentCount || 1 }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>Fach {i + 1}</option>
                  ))}
                </select>
                <button className="pm-btn" onClick={() => assignBead(b)}>Zuweisen</button>
              </div>
            );
          })}
        </div>
      </div>

      {plan && (
        <div className="grid gap-3">
          {plan.map((p) => (
            <div key={p.boxKey} className="pm-card grid gap-2">
              <div className="flex items-center justify-between">
                <strong>{p.boxName}</strong>
                <span className="pm-pill">{p.slots.length} Fach/Fächer belegt</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                {p.slots.map((s) => (
                  <div key={s.comp} className="rounded-xl border bg-card p-2.5 text-sm">
                    <strong>Fach {s.comp}</strong>
                    <div className="my-1 flex flex-wrap gap-1">
                      {s.group.beads.slice(0, 8).map((b) => (
                        <span key={b.key} className="inline-block size-4 rounded-full border" style={{ background: b.hex || "#ccc" }} title={b.id} />
                      ))}
                    </div>
                    <div>{s.group.label}</div>
                    <div className="text-xs text-muted-foreground">{s.group.beads.length} Perle(n)</div>
                  </div>
                ))}
                {!p.slots.length && <p className="text-muted-foreground">Bleibt leer.</p>}
              </div>
              {p.overflow.length > 0 && (
                <p className="text-sm text-destructive">
                  {p.overflow.length} Gruppe(n) passen nicht mehr in die Boxen: {p.overflow.map((g) => `${g.label} (${g.beads.length})`).join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Compare({ beads }: { beads: Rec[] }) {
  const withLab = beads.filter((b) => b.rgb);
  return (
    <div className="pm-card grid gap-2">
      <h2 className="text-xl font-semibold">Farbvergleich</h2>
      <p className="text-muted-foreground">Vergleicht gespeicherte Farbfingerprints lokal. Unsicherheit wird nicht als Identität behandelt.</p>
      {withLab.length < 2 ? <p>Mindestens zwei gespeicherte Farbmessungen werden benötigt.</p> : withLab.map((a) => {
        const la = a.cielab || rgbToLab(a.rgb);
        const others = withLab.filter((x) => x.id !== a.id).map((x) => ({ x, d: deltaE(la, x.cielab || rgbToLab(x.rgb)) })).sort((p, q) => p.d - q.d).slice(0, 3);
        return (
          <div key={a.key} className="rounded-xl border p-3">
            <div className="flex items-center gap-2"><span className="inline-block size-4 rounded-full border" style={{ background: a.hex }} /><strong>{a.id}</strong> · {a.hex}</div>
            <div className="text-xs text-muted-foreground">{others.map((o) => `${o.x.id}: ΔE76 ${o.d.toFixed(2)}`).join(" · ")}</div>
          </div>
        );
      })}
    </div>
  );
}

function Data({ beads, exportJson, reload }: { beads: Rec[]; exportJson: () => void; reload: () => Promise<void> }) {
  const exportCsv = () => {
    const keys = ["id", "scanId", "color", "colorGroup", "colorName", "colorCode", "hex", "size", "surface", "effect", "shape", "material", "transparency", "originalBox", "originalCompartment", "currentBox", "currentCompartment", "status", "confidence", "brightness", "chroma", "hue", "warning", "createdAt", "updatedAt"];
    const q = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    download("perlen-bestand.csv", "text/csv;charset=utf-8", "\ufeff" + keys.map(q).join(";") + "\n" + beads.map((b) => keys.map((k) => q(b[k])).join(";")).join("\n"));
  };
  const importJson = async (f: File) => {
    try {
      const d = JSON.parse(await f.text());
      if (!d || !Array.isArray(d.beads) || !Array.isArray(d.boxes)) throw Error("Ungültiges Backup.");
      if (!confirm(`Backup importieren? ${d.beads.length} Bestände und ${d.boxes.length} Boxen werden lokal ersetzt.`)) return;
      await Promise.all(STORES.map(clearStore));
      for (const x of d.beads) await put("beads", x);
      for (const x of d.boxes) await put("boxes", x);
      for (const x of d.scans || []) await put("scans", x);
      for (const x of d.meta || []) await put("meta", x);
      await initDB(); await reload(); alert("Backup wiederhergestellt.");
    } catch (e) { alert("Import fehlgeschlagen: " + (e as Error).message); }
  };
  return (
    <div className="pm-card grid gap-3">
      <h2 className="text-xl font-semibold">Daten & Backup</h2>
      <div className="flex flex-wrap gap-2">
        <button className="pm-btn" onClick={exportJson}>JSON exportieren</button>
        <button className="pm-btn" onClick={exportCsv}>CSV exportieren</button>
        <label className="pm-btn">JSON wiederherstellen<input type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }} /></label>
        <button className="pm-btn text-destructive" onClick={async () => {
          if (beads.length === 0) { alert("Der Bestand ist bereits leer."); return; }
          if (!confirm(`Wirklich alle ${beads.length} Perlen löschen? Boxen bleiben erhalten. Diese Aktion kann nur mit einem Backup rückgängig gemacht werden.`)) return;
          await clearStore("beads");
          await clearStore("scans");
          await reload(); alert("Alle Perlen wurden gelöscht.");
        }}>Alle Perlen löschen (Boxen bleiben)</button>
        <button className="pm-btn text-destructive" onClick={async () => {
          if (!confirm("Wirklich ALLE lokalen Daten löschen? Diese Aktion kann nur mit einem Backup rückgängig gemacht werden.")) return;
          for (const s of STORES) await clearStore(s);
          await initDB(); reload();
        }}>Gesamten lokalen Bestand löschen</button>
      </div>
      <p className="text-xs text-muted-foreground">Restore überschreibt den lokalen Bestand erst nach Bestätigung. IDs werden aus dem Backup übernommen.</p>
    </div>
  );
}

function gridLines(c: Pt[], rows: number, cols: number) {
  const R = Math.max(1, Math.min(16, rows || 1)), C = Math.max(1, Math.min(16, cols || 1));
  const [tl, tr, br, bl] = c as [Pt, Pt, Pt, Pt];
  const lerp = (a: Pt, b: Pt, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const out: number[][] = [];
  for (let i = 1; i < C; i++) { const a = lerp(tl, tr, i / C), b = lerp(bl, br, i / C); out.push([a.x * 100, a.y * 100, b.x * 100, b.y * 100]); }
  for (let i = 1; i < R; i++) { const a = lerp(tl, bl, i / R), b = lerp(tr, br, i / R); out.push([a.x * 100, a.y * 100, b.x * 100, b.y * 100]); }
  return out;
}
