import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Heart, Music2, Plus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EdlManifest } from "../../project/contracts";
import { formatTimecode } from "../../editor/timecode";
import {
  addAsset, assetFromProbe, localSuggestionProvider, searchAssets,
  type AssetKind, type LibraryAsset,
} from "../../assets/library";
import { canUseAssetLibrary, enumerateLibraryFolder, libraryAssetPreview, probeLibraryAsset } from "../../assets/service";
import { Button } from "../Button";
import { Card } from "../Card";
import { confidenceBand } from "../../editor/automation-policy";

interface Props {
  assets: LibraryAsset[];
  edl: EdlManifest;
  markers: number[];
  onAssetsChange: (assets: LibraryAsset[]) => void;
  onAdd: (asset: LibraryAsset, atUs: number) => void;
  onRelink: (asset: LibraryAsset) => void;
  onLog: (message: string, level?: "info" | "warning" | "error") => void;
  playheadUs: number;
}

function errorText(error: unknown) { if (error instanceof Error) return error.message; if (typeof error === "string") return error; if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message; try { return JSON.stringify(error); } catch { return "Error multimedia desconocido"; } }

export function AssetLibraryWorkspace({ assets, edl, markers, onAssetsChange, onAdd, onRelink, onLog, playheadUs }: Props) {
  const [kind, setKind] = useState<AssetKind | "all">("all");
  const [origin, setOrigin] = useState<"all" | "builtin" | "user">("all");
  const [importKind, setImportKind] = useState<"sfx" | "music">("sfx");
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [limit, setLimit] = useState(60);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [profile, setProfile] = useState<"tutorial" | "gaming" | "presentation">("tutorial");
  const [mode, setMode] = useState<"assisted" | "automatic">(() => localStorage.getItem("cheto.automation.mode") === "automatic" ? "automatic" : "assisted");
  const [ignoredSuggestions, setIgnoredSuggestions] = useState<string[]>(() => { try { const value: unknown = JSON.parse(localStorage.getItem(`cheto.automation.rejected.${edl.projectId}`) ?? "[]"); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; } catch { return []; } });
  const cancelled = useRef(false);
  const selected = assets.find(item => item.id === selectedId) ?? null;
  const filtered = searchAssets(assets, query, kind, favoritesOnly).filter(item => origin === "all" || (origin === "builtin" ? item.origin === "builtin" : item.origin !== "builtin"));
  const suggestions = localSuggestionProvider.suggest(assets, edl, markers, profile).slice(0, 8);
  const setWorkMode = (next: "assisted" | "automatic") => { setMode(next); localStorage.setItem("cheto.automation.mode", next); };
  const rejectSuggestion = (id: string) => setIgnoredSuggestions(current => { const next = [...new Set([...current, id])]; localStorage.setItem(`cheto.automation.rejected.${edl.projectId}`, JSON.stringify(next)); return next; });

  const update = (id: string, changes: Partial<LibraryAsset>) => {
    onAssetsChange(assets.map(item => item.id === id ? { ...item, ...changes } : item));
  };

  const importPaths = async (paths: string[]) => {
    if (!paths.length || busy) return;
    setBusy(true);
    cancelled.current = false;
    setProcessed(0);
    setTotal(paths.length);
    setMessage(null);
    let next = assets;
    let rejected = 0;
    let completed = 0;
    for (let index = 0; index < paths.length; index++) {
      if (cancelled.current) break;
      try {
        const probe = await probeLibraryAsset(paths[index]);
        const candidate = assetFromProbe(probe, importKind);
        next = addAsset(next, candidate);
        onAssetsChange(next);
        onLog("ASSET_IMPORTED");
      } catch (error) {
        rejected++;
        setMessage(`Archivo omitido: ${errorText(error)}`);
      }
      setProcessed(index + 1);
      completed = index + 1;
    }
    setMessage(cancelled.current ? `Importación cancelada tras ${completed} archivos.`
      : `Biblioteca actualizada · ${next.length - assets.length} nuevos, ${rejected} omitidos.`);
    setBusy(false);
  };

  const importFiles = async () => {
    try {
      const picked = await open({ multiple: true, directory: false, title: "Importar SFX, música o GIF",
        filters: [{ name: "Recursos compatibles", extensions: ["wav", "mp3", "m4a", "aac", "ogg", "flac", "gif"] }] });
      if (!picked) return;
      await importPaths(Array.isArray(picked) ? picked : [picked]);
    } catch (error) { setMessage(errorText(error)); }
  };
  useEffect(() => {
    const onDrop = (event: Event) => {
      const paths = (event as CustomEvent<string[]>).detail;
      if (!Array.isArray(paths)) return;
      void (async () => {
        const expanded: string[] = [];
        for (const path of paths) {
          if (/\.(wav|mp3|m4a|aac|ogg|flac|gif)$/i.test(path)) expanded.push(path);
          else { try { expanded.push(...await enumerateLibraryFolder(path)); } catch { /* Unsupported drop. */ } }
        }
        await importPaths(expanded);
      })();
    };
    window.addEventListener("cheto-import-assets", onDrop);
    return () => window.removeEventListener("cheto-import-assets", onDrop);
  });
  const importFolder = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, title: "Importar carpeta multimedia" });
      if (typeof picked !== "string") return;
      await importPaths(await enumerateLibraryFolder(picked));
    } catch (error) { setMessage(errorText(error)); }
  };
  const preview = async (asset: LibraryAsset) => {
    if (playingId === asset.id) { setPlayingId(null); setPreviewUrl(null); return; }
    try {
      setMessage(null);
      const url = await libraryAssetPreview(asset.path);
      setPlayingId(asset.id);
      setPreviewUrl(url);
    } catch (error) {
      setMessage(`Recurso no encontrado o no reproducible: ${errorText(error)}`);
      onLog("ASSET_MISSING", "warning");
    }
  };
  const relink = async (asset: LibraryAsset) => {
    try {
      const picked = await open({ directory: false, multiple: false, title: "Localizar recurso" });
      if (typeof picked !== "string") return;
      const probe = await probeLibraryAsset(picked);
      if ((probe.kind === "overlay") !== (asset.kind === "overlay")) throw new Error("El tipo del nuevo archivo no coincide.");
      const next = { ...asset, ...probe, kind: asset.kind };
      update(asset.id, next);
      onRelink(next);
      setMessage("Ruta del recurso actualizada.");
    } catch (error) { setMessage(errorText(error)); }
  };
  const remove = (asset: LibraryAsset) => {
    if (asset.origin === "builtin") return;
    if ((edl.tracks.assets ?? []).some(item => item.assetId === asset.id)) {
      setMessage("Este recurso se utiliza en el proyecto. Elimina primero sus colocaciones de la timeline.");
      return;
    }
    onAssetsChange(assets.filter(item => item.id !== asset.id));
    if (selectedId === asset.id) setSelectedId(null);
  };

  return <div className="space-y-3">
    <div><h3 className="text-[12px] font-semibold text-ink">Biblioteca multimedia</h3><p className="mt-1 text-[8px] leading-4 text-muted">Referencias a archivos locales. Previsualizar o sugerir no los coloca en el video.</p></div>
    <Card className="space-y-2 p-3">
      <div className="grid grid-cols-2 gap-2"><Button disabled={!canUseAssetLibrary() || busy} icon={<Upload size={12}/>} onClick={() => void importFiles()}>Importar archivos</Button><Button disabled={!canUseAssetLibrary() || busy} icon={<FolderOpen size={12}/>} onClick={() => void importFolder()} variant="secondary">Carpeta</Button></div>
      <label className="block text-[8px] text-muted">Clasificar audio importado<select className="cheto-input mt-1 w-full" onChange={event => setImportKind(event.target.value as "sfx" | "music")} value={importKind}><option value="sfx">SFX</option><option value="music">Música</option></select></label>
      {busy ? <div className="text-[8px] text-muted">Leyendo metadata {processed}/{total}<progress className="w-full accent-cyan" max={total} value={processed}/><Button onClick={() => { cancelled.current = true; }} variant="secondary">Cancelar</Button></div> : null}
      {message ? <p className="text-[8px] leading-4 text-muted">{message}</p> : null}
    </Card>
    <Card className="p-3">
      <div className="mb-2 flex gap-1">{(["all", "builtin", "user"] as const).map(value => <button className={`rounded px-2 py-1 text-[8px] ${origin === value ? "bg-cyan/15 text-cyan" : "text-muted"}`} key={value} onClick={() => setOrigin(value)} type="button">{value === "all" ? "Todos" : value === "builtin" ? "Incluidos" : "Mis recursos"}</button>)}</div>
      <div className="flex gap-1">{(["all", "sfx", "overlay", "music"] as const).map(value => <button className={`rounded px-2 py-1 text-[8px] ${kind === value ? "bg-cyan/15 text-cyan" : "text-muted"}`} key={value} onClick={() => { setKind(value); setLimit(60); }} type="button">{value === "all" ? "Todos" : value === "overlay" ? "GIF" : value === "music" ? "Música" : "SFX"}</button>)}</div>
      <input aria-label="Buscar recursos" className="cheto-input mt-2 w-full" onChange={event => { setQuery(event.target.value); setLimit(60); }} placeholder="Buscar nombre, categoría o tags…" value={query}/>
      <label className="mt-2 flex items-center gap-1 text-[8px] text-muted"><input checked={favoritesOnly} onChange={event => setFavoritesOnly(event.target.checked)} type="checkbox"/>Solo favoritos</label>
      <p className="mt-2 text-[8px] text-muted">{filtered.length} recurso{filtered.length === 1 ? "" : "s"}</p>
      <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">{filtered.slice(0, limit).map(asset => <div className={`rounded border p-2 ${selectedId === asset.id ? "border-cyan/40" : "border-line"}`} key={asset.id}>
        <div className="flex items-start gap-1"><button aria-label="Favorito" className={asset.favorite ? "text-cyan" : "text-muted"} onClick={() => update(asset.id, { favorite: !asset.favorite })} type="button"><Heart size={12} fill={asset.favorite ? "currentColor" : "none"}/></button><button className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(asset.id)} type="button"><strong className="block truncate text-[9px] text-ink">{asset.name}</strong><small className="text-[8px] text-muted">{asset.category} · {asset.durationUs ? formatTimecode(asset.durationUs) : "Duración desconocida"}</small></button><button aria-label="Añadir al cabezal" className="text-cyan" onClick={() => onAdd(asset, playheadUs)} type="button"><Plus size={14}/></button></div>
        <div className="mt-1 flex gap-1"><Button onClick={() => void preview(asset)} variant="secondary">▶ Vista previa</Button>{asset.origin !== "builtin" ? <><button className="text-[8px] text-muted" onClick={() => void relink(asset)} type="button">Localizar</button><button aria-label="Eliminar recurso" className="ml-auto text-muted" onClick={() => remove(asset)} type="button"><X size={11}/></button></> : <span className="ml-auto text-[8px] text-muted">Incluido · {asset.license}</span>}</div>
        {playingId === asset.id && previewUrl ? asset.kind === "overlay" ? <img alt={asset.name} className="mt-2 max-h-28 w-full object-contain" loading="lazy" src={previewUrl}/> : <audio aria-label={`Escuchar ${asset.name}`} autoPlay className="mt-2 w-full" controls src={previewUrl}/> : null}
        <div aria-label={`Arrastrar ${asset.name} a timeline`} className="mt-1 cursor-grab text-[8px] text-muted" draggable onDragStart={event => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/x-cheto-asset-id", asset.id); }}>⋮⋮ Arrastrar a timeline</div>
      </div>)}</div>
      {filtered.length > limit ? <Button className="mt-2 w-full" onClick={() => setLimit(limit + 60)} variant="secondary">Mostrar más</Button> : null}
    </Card>
    {selected ? <Card className="space-y-2 p-3"><p className="text-[10px] font-semibold text-ink">Metadata · {selected.name}</p>
      {(["name", "category", "author", "license", "source", "sourceUrl", "notes"] as const).map(field => <label className="block text-[8px] text-muted" key={field}>{field}<input className="cheto-input mt-1 w-full" disabled={selected.origin === "builtin"} onChange={event => update(selected.id, { [field]: event.target.value })} value={selected[field]}/></label>)}
      <label className="block text-[8px] text-muted">Tags (separados por coma)<input className="cheto-input mt-1 w-full" disabled={selected.origin === "builtin"} onChange={event => update(selected.id, { tags: event.target.value.split(",").map(tag => tag.trim()).filter(Boolean) })} value={selected.tags.join(", ")}/></label>
      <label className="block text-[8px] text-muted">Uso comercial<select className="cheto-input mt-1 w-full" disabled={selected.origin === "builtin"} onChange={event => update(selected.id, { commercialUse: event.target.value === "unknown" ? null : event.target.value === "yes" })} value={selected.commercialUse === null ? "unknown" : selected.commercialUse ? "yes" : "no"}><option value="unknown">No registrado</option><option value="yes">Permitido según fuente</option><option value="no">No permitido</option></select></label>
      <label className="block text-[8px] text-muted">Atribución<select className="cheto-input mt-1 w-full" disabled={selected.origin === "builtin"} onChange={event => update(selected.id, { attributionRequired: event.target.value === "unknown" ? null : event.target.value === "yes" })} value={selected.attributionRequired === null ? "unknown" : selected.attributionRequired ? "yes" : "no"}><option value="unknown">No registrado</option><option value="yes">Requerida</option><option value="no">No requerida</option></select></label>
      <p className="text-[8px] text-muted">La licencia es información registrada por ti; CHETO no verifica derechos automáticamente.</p>
    </Card> : null}
    <Card className="space-y-2 p-3"><div className="flex items-center gap-1"><Music2 size={13} className="text-cyan"/><p className="text-[10px] font-semibold text-ink">Sugerencias locales</p></div><label className="block text-[8px] text-muted">Modo de trabajo<select aria-label="Modo de trabajo" className="cheto-input mt-1 w-full" onChange={event => setWorkMode(event.target.value as "assisted" | "automatic")} value={mode}><option value="assisted">Asistido · revisar antes de aplicar</option><option value="automatic">Automático · política segura</option></select></label><p className="text-[8px] text-muted">En 13D las propuestas conservan control manual; el modo automático queda preparado y no aplica sugerencias de confianza media o baja.</p>
      <select aria-label="Perfil del proyecto" className="cheto-input w-full" onChange={event => setProfile(event.target.value as typeof profile)} value={profile}><option value="tutorial">Tutorial</option><option value="gaming">Gameplay</option><option value="presentation">Presentación</option></select>
      {suggestions.filter(suggestion => !ignoredSuggestions.includes(suggestion.id)).length ? suggestions.filter(suggestion => !ignoredSuggestions.includes(suggestion.id)).map(suggestion => { const asset = assets.find(item => item.id === suggestion.assetId); return asset ? <div className="rounded border border-line p-2" key={suggestion.id}><strong className="text-[9px] text-ink">{asset.name}</strong><p className="text-[8px] text-muted">{formatTimecode(suggestion.startUs)} · {suggestion.reason} · confianza {Math.round(suggestion.confidence * 100)}% ({confidenceBand(suggestion.confidence)})</p><div className="mt-1 flex gap-1"><Button onClick={() => void preview(asset)} variant="secondary">▶</Button><Button onClick={() => onAdd(asset, suggestion.startUs)} variant="secondary">Aplicar</Button><Button onClick={() => rejectSuggestion(suggestion.id)} variant="secondary">Ignorar</Button></div></div> : null; }) : <p className="text-[8px] text-muted">Importa recursos etiquetados para recibir propuestas. Ninguna se aplica automáticamente.</p>}
    </Card>
  </div>;
}
