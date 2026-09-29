import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { resolveChetoPackResource } from "./service";
import { isPackResourceId } from "../templates/registry";

type ResourceState = { url: string; error: string };
const resources = new Map<string, Promise<ResourceState>>();
const fonts = new Map<string, Promise<string>>();
const loadedFaces = new Map<string, FontFace>();
let resourceEpoch = 0;
const subscribe = (listener: () => void) => { window.addEventListener("cheto-pack-resources-changed", listener); return () => window.removeEventListener("cheto-pack-resources-changed", listener); };

export function fontFamilyForId(id: string): string {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `CHETO-Pack-${(hash >>> 0).toString(16)}`;
}

async function resolveUrl(id: string): Promise<ResourceState> {
  if (!isPackResourceId(id)) return { url: "", error: "ID de recurso de paquete inválido" };
  if (!isTauri()) return { url: "", error: "Recursos locales disponibles solo en CHETO" };
  try {
    const resource = await resolveChetoPackResource(id);
    return { url: convertFileSrc(resource.path), error: "" };
  } catch (reason) {
    return { url: "", error: `Recurso del paquete no disponible: ${String(reason)}` };
  }
}

export function usePackResource(id: string | undefined): ResourceState {
  const [state, setState] = useState<ResourceState>({ url: "", error: "" });
  const [epoch, setEpoch] = useState(resourceEpoch);
  useEffect(() => subscribe(() => { setState({ url: "", error: "" }); setEpoch(resourceEpoch); }), []);
  useEffect(() => {
    if (!id) return;
    let active = true;
    let pending = resources.get(id);
    if (!pending) { pending = resolveUrl(id); resources.set(id, pending); }
    void pending.then(value => { if (active) setState(value); });
    return () => { active = false; };
  }, [id, epoch]);
  return id ? state : { url: "", error: "" };
}

export function usePackFont(id: string | undefined): { family: string; error: string; ready: boolean } {
  const resource = usePackResource(id);
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id || !resource.url) return;
    let active = true;
    let pending = fonts.get(id);
    if (!pending) {
      const family = fontFamilyForId(id);
      const face = new FontFace(family, `url("${resource.url}")`);
      pending = face.load().then(value => { document.fonts.add(value); loadedFaces.set(id, value); return family; });
      fonts.set(id, pending);
    }
    void pending.then(family => { if (active) setLoaded(family); }).catch(reason => { if (active) setError(`No se pudo cargar la fuente del paquete: ${String(reason)}`); });
    return () => { active = false; };
  }, [id, resource.url]);
  return { family: resource.url && loaded === fontFamilyForId(id ?? "") ? loaded : "", error: resource.error || error, ready: !id || !!resource.url && loaded === fontFamilyForId(id) };
}

export function clearPackResourceCache(): void {
  resources.clear(); fonts.clear();
  for (const face of loadedFaces.values()) document.fonts.delete(face);
  loadedFaces.clear(); resourceEpoch++;
  window.dispatchEvent(new Event("cheto-pack-resources-changed"));
}
