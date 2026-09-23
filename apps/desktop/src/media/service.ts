import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isSupportedVideo } from "../lib/format";
import type { FfprobeStatus, NativeProbeResponse, ProbeResult, SourceCheck } from "./models";
import { parseProbeJson } from "./normalize";

const browserStatus: FfprobeStatus = {
  available: false,
  detail: "La detección de FFprobe sólo está disponible dentro de la aplicación Tauri.",
  executable: "ffprobe",
  version: null,
};

export async function detectFfprobe(): Promise<FfprobeStatus> {
  if (!isTauri()) return browserStatus;
  return invoke<FfprobeStatus>("detect_ffprobe");
}

export async function selectVideoPath(): Promise<string | null> {
  if (!isTauri()) throw new Error("Abre la aplicación nativa para seleccionar una ruta local real.");
  const selection = await open({
    directory: false,
    multiple: false,
    title: "Seleccionar video fuente",
    filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "avi"] }],
  });
  if (!selection) return null;
  if (typeof selection !== "string") throw new Error("La selección nativa no devolvió una ruta válida.");
  if (!isSupportedVideo(selection)) throw new Error("Este formato todavía no está soportado.");
  return selection;
}

export async function probeVideo(path: string): Promise<ProbeResult> {
  if (!isTauri()) throw new Error("La lectura de metadata requiere la aplicación nativa.");
  const response = await invoke<NativeProbeResponse>("probe_media", { path });
  return { elapsedMs: response.elapsedMs, metadata: parseProbeJson(response.rawJson, response.source) };
}

export async function checkVideoSource(
  path: string,
  expectedSizeBytes: number,
  expectedLastModifiedMs: number | null,
): Promise<SourceCheck> {
  if (!isTauri()) return { changed: false, exists: true, lastModifiedMs: null, sizeBytes: null };
  return invoke<SourceCheck>("check_media_source", { expectedLastModifiedMs, expectedSizeBytes, path });
}
