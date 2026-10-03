import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzeGrid, type Pt, clearStore, del, deltaE, download, getAll, initDB, nextId, now, put, rgbToLab, STORES, type Rec,
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
  size: ["", "1mm", "2mm", "3mm", "4mm", "5mm", "6mm", "7mm", "8mm", "1cm"],
  surface: ["", "glänzend", "glatt", "facettiert", "matt", "satin"],
  effect: ["", "crackle", "opak", "marmoriert", "inneneinzug", "silbereinzug", "perlmut", "transparent", "irisierend", "metallic", "lustre"],
  form: ["", "rund", "rocailles", "bicone", "rondell"],
  material: ["", "plastik", "glas", "kristallglas"],
  transparency: ["", "transparent", "opak", "transluzent", "kristallklar"],
};
const ATTR_LABEL: Record<string, string> = {
  size: "Größe", surface: "Oberfläche", effect: "Effekt", form: "Form", material: "Material", transparency: "Transparenz",
};

const TABS = [
  ["dashboard", "Übersicht"], ["scan", "Foto analysieren"], ["inventory", "Bestand"],
  ["boxes", "Boxen"], ["compare", "Vergleich"], ["data", "Daten"],
] as const;
type Tab = (typeof TABS)[number][0];

type Comp = {
  number: number; status: string; color: string | null; attrs: Record<string, string>;
  hex?: string; rgb?: { r: number; g: number; b: number }; confidence?: number; warning?: string; colorName?: string; saved?: boolean;
};

function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [beads, setBeads] = useState<Rec[]>([]);
  const [boxes, setBoxes] = useState<Rec[]>([]);
  const [scans, setScans] = useState<Rec[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const [b, x, s] = await Promise.all([getAll("beads"), getAll("boxes"), getAll("scans")]);
    setBeads(b); setBoxes(x); setScans(s);
  }, []);

  useEffect(() => {
    initDB().then(reload).then(() => setReady(true));
  }, [reload]);

  const exportJson = async () => {
    const [b, x, s, m] = await Promise.all(STORES.map((st) => getAll(st)));
    download("perlen-backup.json", "application/json", JSON.stringify({ version: 1, exportedAt: now(), beads: b, boxes: x, scans: s, meta: m }, null, 2));
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
          {tab === "scan" && <Scan boxes={boxes} reload={reload} goBoxes={() => setTab("boxes")} />}
          {tab === "inventory" && <Inventory beads={beads} reload={reload} />}
          {tab === "boxes" && <Boxes boxes={boxes} beads={beads} reload={reload} />}
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
  beads.forEach((b) => { const k = b.colorName || "Unbekannt"; colors.set(k, (colors.get(k) || 0) + 1); });
  const kpis: [string, number][] = [
    ["Bestände", beads.length], ["Boxen", boxes.length],
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
        <h2 className="mb-2 text-xl font-semibold">Farben im Bestand</h2>
        {colors.size ? (
          <div className="flex flex-wrap gap-1.5">
            {[...colors].sort((a, b) => b[1] - a[1]).map(([c, n]) => <span key={c} className="pm-pill">{c} · {n}</span>)}
          </div>
        ) : <span className="text-muted-foreground">Noch keine Farbdaten.</span>}
      </div>
    </>
  );
}

function Scan({ boxes, reload, goBoxes }: { boxes: Rec[]; reload: () => Promise<void>; goBoxes: () => void }) {
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
      setComps(base.map((x, i) => idx.has(i)
        ? { ...x, hex: res[i]!.hex, rgb: { r: res[i]!.r, g: res[i]!.g, b: res[i]!.b }, confidence: res[i]!.confidence, warning: res[i]!.warning ?? "", status: "Unsicher" } : x));
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
    let saved = 0;
    for (const c of comps) {
      if (!c.hex || c.saved) continue;
      const id = await nextId("ID");
      await put("beads", {
        key: id, id, scanId: sk, createdAt: now(), updatedAt: now(),
        originalBox: b, originalCompartment: c.number, currentBox: b, currentCompartment: c.number,
        color: c.color || null, colorGroup: null, colorName: null, colorCode: null, hex: c.hex || null, rgb: c.rgb || null,
        oklab: null, cielab: null, deltaE00: null, fingerprint: null, confidence: c.confidence ?? null,
        reflectionPercentage: null, brightness: null, chroma: null, saturation: null, distribution: null,
        ...c.attrs, status: c.status, warning: c.warning || null, manualChanges: [], history: [],
      });
      saved++;
    }
    setComps((cs) => cs.map((c) => (c.hex ? { ...c, saved: true } : c)));
    await put("scans", { key: sk, createdAt: now(), compartments: comps, box: b });
    setStatus(`${saved} Perle(n) gespeichert. Eigenschaften kannst du später im Bestand zuweisen.`);
    reload();
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
          <label className="pm-btn-primary">Vorhandenes Foto auswählen
            <input type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]; if (f) { setImage({ file: f, url: URL.createObjectURL(f) }); setCorners(DEFAULT_CORNERS); }
            }} />
          </label>
          <button className="pm-btn" onClick={async () => {
            setScanKey(await nextId("SCAN")); setComps([]); setSel(new Set()); setProg(0); setCorners(DEFAULT_CORNERS);
            setStatus(image ? "Neuer Scan bereit. Ziehe die 4 Ecken des Rasters auf die Ecken der Box." : "Neuer Scan bereit. Bitte zuerst ein Foto auswählen.");
          }}>Neuen Scan beginnen</button>
        </div>
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
        <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Fächer</h2><span className="pm-pill">{sel.size} ausgewählt</span></div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
          {comps.map((c, i) => (
            <button key={i} onClick={() => toggle(i)}
              className={`min-h-26 rounded-xl border bg-card p-2.5 text-left ${sel.has(i) ? "outline-3 outline-primary" : ""}`}>
              <strong>Fach {c.number}</strong>
              <div className="my-1.5 h-9 rounded-lg bg-muted" style={c.hex ? { background: c.hex } : undefined} />
              <span className="text-xs">{c.colorName || (c.hex ?? "Noch nicht analysiert")}</span>
              <div className="text-xs text-muted-foreground">{c.status}</div>
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
          setComps((cs) => cs.map((c, i) => sel.has(i) ? { ...c, attrs: { ...c.attrs, ...ch }, status: "Manuell korrigiert" } : c));
        }}>Auf Auswahl anwenden</button></div>
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

function Inventory({ beads, reload }: { beads: Rec[]; reload: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [st, setSt] = useState("");
  const [detail, setDetail] = useState<Rec | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (detail) dlg.current?.showModal(); }, [detail]);
  const arr = beads.filter((b) => (!q || JSON.stringify(b).toLowerCase().includes(q.toLowerCase())) && (!st || b.status === st));
  return (
    <div className="pm-card grid gap-3">
      <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Bestand</h2><span className="pm-pill">{arr.length} / {beads.length}</span></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="pm-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID, Farbe, Farbgruppe, Farbname, Farbcode, Box, Fach ..." />
        <select className="pm-field" value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">Alle Status</option>
          {["Unsicher", "Analysiert", "Manuell korrigiert", "Geprüft", "Gespeichert"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left">{["ID", "Farbe", "Farbgruppe", "Farbname", "Farbcode", "Standort", "Status"].map((h) => <th key={h} className="border-b p-2.5">{h}</th>)}</tr></thead>
          <tbody>
            {arr.map((b) => (
              <tr key={b.key} onClick={() => setDetail(b)} className="cursor-pointer hover:bg-muted">
                <td className="border-b p-2.5"><strong>{b.id}</strong><div className="text-xs">{b.scanId}</div></td>
                <td className="border-b p-2.5"><span className="inline-flex items-center gap-1.5">
                  {b.hex && <span className="inline-block size-4 rounded-full border" style={{ background: b.hex }} />}{b.color || "—"} {b.hex && <span className="pm-pill">{b.hex}</span>}</span></td>
                <td className="border-b p-2.5">{b.colorGroup || "—"}</td>
                <td className="border-b p-2.5">{b.colorName || "—"}</td>
                <td className="border-b p-2.5">{b.colorCode || "—"}</td>
                <td className="border-b p-2.5">{b.currentBox || "—"} · Fach {b.currentCompartment || "—"}</td>
                <td className="border-b p-2.5"><span className="pm-pill">{b.status}</span></td>
              </tr>
            ))}
            {!arr.length && <tr><td colSpan={7} className="p-2.5 text-muted-foreground">Keine Einträge.</td></tr>}
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
              const rec = { ...detail, status: "Manuell korrigiert", updatedAt: now() };
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
    const keys = ["id", "scanId", "color", "colorGroup", "colorName", "colorCode", "hex", "size", "surface", "effect", "form", "material", "transparency", "quantity", "originalBox", "originalCompartment", "currentBox", "currentCompartment", "status", "confidence", "createdAt", "updatedAt"];
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
