import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exportChetoPack, inspectChetoPack, installChetoPack, listChetoPacks, loadInstalledTemplates, packageTemplate, resolveChetoPackResource, uninstallChetoPack, validPackId, validPackVersion, verifyChetoPack, type ExportPackRequest, type InstalledPack, type PackInspection } from "../../packs/service";
import { TEMPLATE_REGISTRY, type TemplateManifest } from "../../templates/registry";
import { clearPackResourceCache } from "../../packs/runtime";

const field = "w-full rounded border border-line bg-canvas px-2 py-1.5 text-xs text-ink";
const button = "rounded border border-line bg-panel px-2 py-1.5 text-[10px] font-semibold text-ink hover:border-cyan disabled:opacity-40";
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
type PendingResource = NonNullable<ExportPackRequest["resources"]>[number];
const resourceKind = (path: string) => /\.(ttf|otf)$/i.test(path) ? "font" : "asset";
const resourcePackPath = (path: string) => {
  const name = path.split(/[\\/]/).at(-1)?.replace(/[^a-zA-Z0-9._-]/g, "-") || "resource";
  return resourceKind(path) === "font" ? `fonts/${name}` : `assets/images/${name}`;
};

export function PackWorkspace({ templates, onRegistryChange, onEvent }: { templates: TemplateManifest[]; onRegistryChange: () => void; onEvent?: (event: string, level?: "warning" | "error") => void }) {
  const [view, setView] = useState<"library" | "export" | "import">("library");
  const [packs, setPacks] = useState<InstalledPack[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [packName, setPackName] = useState("Mis plantillas");
  const [packId, setPackId] = useState("com.cheto.mis-plantillas");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("Usuario local");
  const [destination, setDestination] = useState("");
  const [createdPath, setCreatedPath] = useState("");
  const [importPath, setImportPath] = useState("");
  const [inspection, setInspection] = useState<PackInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const [resources, setResources] = useState<PendingResource[]>([]);
  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    const [installed, manifests] = await Promise.all([listChetoPacks(), loadInstalledTemplates()]);
    const problems = TEMPLATE_REGISTRY.replacePackTemplates(manifests);
    if (problems.length) throw new Error(problems.join("; "));
    clearPackResourceCache();
    setPacks(installed);
    onRegistryChange();
  }, [onRegistryChange]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh().catch(reason => setError(message(reason))); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch (reason) {
      const detail = message(reason);
      setError(detail);
      onEvent?.(detail.includes("CHETOPACK_CHECKSUM_FAILED") ? "CHETOPACK_CHECKSUM_FAILED" : /ruta insegura|Enlace|tipo de archivo no permitido|Colisión|archivo no declarado/i.test(detail) ? "CHETOPACK_SECURITY_REJECTED" : "CHETOPACK_VALIDATION_FAILED", "error");
    } finally { setBusy(false); }
  };
  const choosePack = () => void withBusy(async () => {
    const path = await open({ multiple:false, filters:[{ name:"Paquete CHETO", extensions:["chetopack"] }] });
    if (typeof path !== "string") return;
    setImportPath(path); setInspection(null); onEvent?.("CHETOPACK_IMPORT_STARTED");
    const result = await inspectChetoPack(path);
    setInspection(result); onEvent?.("CHETOPACK_VALIDATION_OK"); setView("import");
  });
  const selectDestination = () => void withBusy(async () => {
    const path = await save({ defaultPath:`${packId.split(".").at(-1) ?? "plantillas"}-${version}.chetopack`, filters:[{ name:"Paquete CHETO", extensions:["chetopack"] }] });
    if (path) setDestination(path.endsWith(".chetopack") ? path : `${path}.chetopack`);
  });
  const createPack = () => void withBusy(async () => {
    if (!validPackId(packId) || !validPackVersion(version) || !selected.length || !destination) throw new Error("Completa ID, versión, plantillas y destino.");
    onEvent?.("CHETOPACK_EXPORT_STARTED");
    const sourceTemplates = templates.filter(item => selected.includes(`${item.templateId}@${item.templateVersion}`));
    const externalIds = [...new Set(sourceTemplates.flatMap(item => [...item.fontRefs, ...item.assetRefs, ...(item.graphicLayer ? [item.graphicLayer.assetId] : [])]).filter(item => item.startsWith("pack:")))];
    const closure: PendingResource[] = [];
    for (const id of externalIds) {
      const resolved = await resolveChetoPackResource(id);
      const relative = id.split(":").slice(2).join(":");
      closure.push({ path: relative, sourcePath: resolved.path, license: { resourceId: relative, resourceType: resolved.resourceType, name: resolved.licenseName, licenseId: resolved.licenseId, licenseTextRef: resolved.licenseTextRef, source: resolved.licenseSource, author: resolved.licenseAuthor, copyright: "", redistributionAllowed: true, modified: false, notes: "Dependencia detectada automáticamente" } });
      if (resolved.licenseTextRef && resolved.licenseTextPath) closure.push({ path: resolved.licenseTextRef, sourcePath: resolved.licenseTextPath, license: { resourceId: resolved.licenseTextRef, resourceType: "license", name: resolved.licenseTextRef, licenseId: resolved.licenseId, source: resolved.licenseSource, author: resolved.licenseAuthor, copyright: "", redistributionAllowed: true, modified: false, notes: "Texto de licencia" } });
    }
    const chosen = sourceTemplates.map(item => packageTemplate(item, packId, version));
    if (resources.some(item => !item.license.licenseId.trim() || !item.license.source.trim() || !item.license.author.trim())) throw new Error("Falta información de licencia para distribuir este recurso.");
    const allResources = [...closure, ...resources].filter((item, index, list) => list.findIndex(other => other.path.toLowerCase() === item.path.toLowerCase()) === index);
    const path = await exportChetoPack({ packId, packVersion:version, name:packName, description, author, outputPath:destination, templates:chosen, resources: allResources });
    setCreatedPath(path); onEvent?.("CHETOPACK_EXPORT_COMPLETED");
  });
  const install = () => void withBusy(async () => {
    if (!inspection || !importPath || inspection.status === "already_installed" || inspection.status === "older") return;
    const update = inspection.status === "update";
    await installChetoPack(importPath);
    onEvent?.(update ? "CHETOPACK_UPDATED" : "CHETOPACK_INSTALLED");
    await refresh(); setInspection(null); setImportPath(""); setView("library");
  });
  const remove = (pack: InstalledPack) => void withBusy(async () => {
    await uninstallChetoPack(pack.packId,pack.packVersion);
    onEvent?.("CHETOPACK_UNINSTALLED");
    setConfirmUninstall(null); await refresh();
  });
  const verify = (pack: InstalledPack) => void withBusy(async () => {
    await verifyChetoPack(pack.packId, pack.packVersion);
    setVerified(`${pack.packId}@${pack.packVersion}`);
  });
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current,id]);
  const openResult = (kind: "file" | "folder") => void invoke(kind === "file" ? "open_export_file" : "reveal_export_file", { path:createdPath }).catch(reason => setError(message(reason)));
  const matchingPacks = packs.filter(pack => {
    const query = libraryQuery.trim().toLocaleLowerCase();
    return !query || [pack.name, pack.author, pack.packId, ...pack.templates.map(item => TEMPLATE_REGISTRY.getTemplate(item.templateId, item.templateVersion)?.name ?? item.templateId)].some(value => value.toLocaleLowerCase().includes(query));
  });
  const chooseResources = () => void withBusy(async () => {
    const picked = await open({ multiple:true, filters:[{ name:"Recursos de paquete", extensions:["ttf","otf","png","jpg","jpeg","webp","gif"] }] });
    const paths = typeof picked === "string" ? [picked] : picked ?? [];
    setResources(current => [...current, ...paths.map(sourcePath => ({
      sourcePath, path: resourcePackPath(sourcePath),
      license: { resourceId: resourcePackPath(sourcePath), resourceType: resourceKind(sourcePath), name: sourcePath.split(/[\\/]/).at(-1) ?? "Recurso", licenseId:"", source:"", author:"", copyright:"", redistributionAllowed:true, modified:false, notes:"" }
    }))]);
  });
  const updateResource = (index: number, patch: { path?: string; license?: Partial<PendingResource["license"]> }) => setResources(current => current.map((resource, position) => position === index ? { ...resource, ...patch, license: { ...resource.license, ...patch.license, resourceId: patch.path ?? resource.path } } : resource));
  return <section className="space-y-2 rounded-lg border border-line bg-panel p-2 text-[10px] text-ink">
    <div className="flex items-center justify-between gap-2"><h3 className="font-bold text-cyan">Mis paquetes</h3><div className="flex gap-1"><button className={button} disabled={busy} onClick={() => {setView("export");setError("");}} type="button">Exportar .chetopack</button><button className={button} disabled={busy || !isTauri()} onClick={choosePack} type="button">Importar .chetopack</button></div></div>
    {error && <p className="rounded border border-red-500/40 bg-red-950/30 p-2 text-red-200" role="alert">{error}</p>}
    {view === "library" && <div className="space-y-1"><input aria-label="Buscar paquetes" className={field} onChange={event => setLibraryQuery(event.target.value)} placeholder="Buscar por nombre, autor o plantilla" value={libraryQuery}/>{matchingPacks.length ? matchingPacks.map(pack => <div className="rounded border border-line p-2" key={`${pack.packId}@${pack.packVersion}`}><div className="flex items-start justify-between gap-2"><div><strong>{pack.name}</strong> · {pack.packVersion}<p className="text-muted">{pack.author} · {pack.templates.length} plantillas · {formatBytes(pack.sizeBytes)}</p><p className="break-all text-muted">{pack.packId}</p>{verified === `${pack.packId}@${pack.packVersion}` && <p className="text-green-300">Integridad verificada</p>}</div><div className="flex gap-1"><button className={button} disabled={busy} onClick={() => verify(pack)} type="button">Verificar</button>{confirmUninstall === `${pack.packId}@${pack.packVersion}` ? <><button className={button} disabled={busy} onClick={() => remove(pack)} type="button">Confirmar</button><button className={button} onClick={() => setConfirmUninstall(null)} type="button">Cancelar</button></> : <button className={button} onClick={() => setConfirmUninstall(`${pack.packId}@${pack.packVersion}`)} type="button">Desinstalar</button>}</div></div></div>) : <p className="text-muted">{packs.length ? "Sin paquetes para esta búsqueda." : "Aún no hay paquetes instalados."}</p>}</div>}
    {view === "export" && <div className="space-y-2"><div className="grid grid-cols-2 gap-2"><label>Nombre<input className={field} onChange={event => setPackName(event.target.value)} value={packName}/></label><label>Versión<input className={field} onChange={event => setVersion(event.target.value)} value={version}/></label><label className="col-span-2">ID estable<input className={field} onChange={event => setPackId(event.target.value.toLowerCase().replace(/[^a-z0-9.-]/g,"-"))} value={packId}/></label><label>Autor<input className={field} onChange={event => setAuthor(event.target.value)} value={author}/></label><label>Descripción<input className={field} onChange={event => setDescription(event.target.value)} value={description}/></label></div>
      <p className="font-semibold">Plantillas incluidas ({selected.length})</p><div className="max-h-40 space-y-1 overflow-auto rounded border border-line p-2">{templates.map(item => {const key=`${item.templateId}@${item.templateVersion}`;return <label className="flex items-center gap-2" key={key}><input checked={selected.includes(key)} onChange={() => toggle(key)} type="checkbox"/>{item.name} <span className="text-muted">{item.templateVersion}</span></label>;})}</div>
      <div className="rounded border border-line p-2"><div className="flex items-center justify-between"><strong>Recursos del paquete</strong><button className={button} disabled={busy} onClick={chooseResources} type="button">Añadir recurso</button></div><p className="text-muted">Los recursos requeridos y adicionales se copian dentro del paquete; no se guarda la ruta original.</p>{resources.map((resource,index) => <div className="mt-2 grid grid-cols-2 gap-1" key={`${resource.sourcePath}-${index}`}><span className="col-span-2 truncate">{resource.license.name} · {resource.path}</span><input aria-label={`Licencia ${index}`} className={field} onChange={event => updateResource(index,{ license:{ licenseId:event.target.value }})} placeholder="Licencia (OFL-1.1, MIT…)" value={resource.license.licenseId}/><input aria-label={`Origen ${index}`} className={field} onChange={event => updateResource(index,{ license:{ source:event.target.value }})} placeholder="Origen" value={resource.license.source}/><input aria-label={`Autor ${index}`} className={field} onChange={event => updateResource(index,{ license:{ author:event.target.value }})} placeholder="Autor" value={resource.license.author}/><button className={button} onClick={() => setResources(current => current.filter((_,position) => position !== index))} type="button">Quitar</button></div>)}{!resources.length && <p className="text-muted">Sin recursos externos.</p>}</div><p className="text-muted">Dependencias built-in: Inter, Instrument Serif y primitivas declaradas. Assets externos: {resources.filter(item=>item.path.startsWith("assets/")).length} · Fuentes externas: {resources.filter(item=>item.path.startsWith("fonts/")).length} · Licencias: {selected.length + resources.length}.</p><div className="flex items-center gap-2"><button className={button} disabled={busy} onClick={selectDestination} type="button">Elegir destino</button><span className="min-w-0 break-all text-muted">{destination || "Sin destino"}</span></div><button className={button} disabled={busy || !destination || !selected.length || !validPackId(packId) || !validPackVersion(version)} onClick={createPack} type="button">Crear .chetopack</button>
      {createdPath && <div className="rounded border border-cyan/40 p-2"><strong>Paquete creado correctamente</strong><p className="break-all">{createdPath}</p><div className="mt-1 flex flex-wrap gap-1"><button className={button} onClick={() => openResult("file")} type="button">Abrir archivo</button><button className={button} onClick={() => openResult("folder")} type="button">Abrir carpeta</button><button className={button} onClick={() => void navigator.clipboard.writeText(createdPath)} type="button">Copiar ruta</button></div></div>}
      <button className={button} onClick={() => setView("library")} type="button">Volver</button></div>}
    {view === "import" && inspection && <div className="space-y-2 rounded border border-line p-2"><h4 className="font-bold">{inspection.manifest.name} · {inspection.manifest.packVersion}</h4><p>{inspection.manifest.description}</p><p className="text-muted">Autor: {inspection.manifest.author} · {inspection.manifest.templates.length} plantillas · {inspection.manifest.fontRefs.length} fuentes · {inspection.manifest.assetRefs.length} assets · {formatBytes(inspection.sizeBytes)}</p><p className="break-all text-muted">{importPath}</p><p className="font-semibold">Estado: {inspection.status === "compatible" ? "Compatible" : inspection.status === "update" ? "Actualización disponible" : inspection.status === "older" ? "Versión anterior" : "Ya está instalado"}</p>{inspection.warnings.map(warning => <p className="text-yellow-300" key={warning}>{warning}</p>)}<details><summary className="cursor-pointer">Contenido y licencias ({inspection.licenses.length})</summary><ul className="space-y-1 pt-1">{inspection.manifest.templates.map(item => <li key={item.path}>{item.templateId}@{item.templateVersion}</li>)}{inspection.licenses.map(item => <li className="text-muted" key={item.resourceId}>{item.name}: {item.licenseId} · {item.source}</li>)}</ul></details><p className="text-muted">CHETO mínimo: {inspection.manifest.minimumChetoVersion} · SHA-256 verificado.</p><div className="flex gap-2"><button className={button} disabled={busy || inspection.status === "already_installed" || inspection.status === "older"} onClick={install} type="button">{inspection.status === "update" ? "Actualizar paquete" : "Instalar paquete"}</button><button className={button} onClick={() => {setInspection(null);setView("library");}} type="button">Cancelar</button></div></div>}
  </section>;
}
