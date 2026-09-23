import { describe, expect, it } from "vitest";
import fixture from "../media/__fixtures__/ffprobe-standard.json";
import { normalizeProbe } from "../media/normalize";
import type { LocalProject } from "../types/project";
import { countEdlTracks, createManifestInitializationRequest, secondsToMicroseconds } from "./conversion";
import { projectStorageErrorMessage } from "./service";

const projectId = "77f0f15f-cf3c-4a39-a2e6-1cd5528b13d0";
const sourceId = "c2ecbf0c-c2f0-4aa3-97df-3e82d60ef9a4";
const timestamp = "2026-09-23T12:00:00.000Z";

function localProject(): LocalProject {
  const metadata = normalizeProbe(fixture, {
    fileName: "video real.mp4",
    lastModifiedMs: 1_760_000_000_000,
    path: "D:\\Videos\\video real.mp4",
    sizeBytes: 9_040_901_734,
  });
  return {
    schemaVersion: 2,
    id: projectId,
    name: "Proyecto migrado V2",
    createdAt: timestamp,
    manifest: null,
    metadata,
    source: {
      fileName: metadata.fileName,
      lastModifiedMs: metadata.lastModifiedMs,
      path: metadata.path,
      sizeBytes: metadata.sizeBytes,
    },
    status: "ready",
  };
}

describe("project manifest", () => {
  it("convierte segundos a microsegundos enteros", () => {
    expect(secondsToMicroseconds(58.000123)).toBe(58_000_123);
    expect(secondsToMicroseconds(null)).toBeNull();
    expect(secondsToMicroseconds(-1)).toBeNull();
  });

  it("convierte un proyecto localStorage V2 en una solicitud de inicialización", () => {
    const request = createManifestInitializationRequest(localProject(), timestamp, sourceId);
    expect(request.project).toMatchObject({
      schemaVersion: 1,
      projectId,
      name: "Proyecto migrado V2",
      source: { sourceId, sourceJson: "source.json" },
      edl: { schemaVersion: 1, file: "edl.json" },
    });
    expect(request.source).toMatchObject({
      schemaVersion: 1,
      sourceId,
      extension: ".mp4",
      durationUs: 6_137_245_000,
    });
    expect(request.edl.tracks).toEqual({ cuts: [], camera: [], captions: [], broll: [], audio: [] });
    expect(request.edl.timebase.unit).toBe("microseconds");
  });

  it("cuenta los tracks EDL sin interpretar decisiones", () => {
    const bundle = createManifestInitializationRequest(localProject(), timestamp, sourceId);
    bundle.edl.tracks.cuts.push({ id: crypto.randomUUID(), startUs: 1, endUs: 2, action: "remove", reason: null, confidence: 0.9 });
    bundle.edl.tracks.camera.push({ id: crypto.randomUUID(), startUs: 3, endUs: 4, mode: "zoom", zoom: 1.2, centerX: 0.5, centerY: 0.5, easing: "smooth", reason: null, confidence: null });
    expect(countEdlTracks(bundle)).toEqual({ audio: 0, broll: 0, camera: 1, captions: 0, cuts: 1 });
    expect(countEdlTracks(null)).toEqual({ audio: 0, broll: 0, camera: 0, captions: 0, cuts: 0 });
  });

  it("normaliza errores del backend sin lanzar una segunda excepción", () => {
    expect(projectStorageErrorMessage({ code: "corrupt-json", message: "project.json contiene JSON inválido." })).toBe(
      "project.json contiene JSON inválido.",
    );
    expect(projectStorageErrorMessage(null)).toBe("No se pudo acceder al almacenamiento local del proyecto.");
  });

  it("rechaza la migración cuando V2 no contiene metadata real", () => {
    const project = localProject();
    project.metadata = null;
    expect(() => createManifestInitializationRequest(project, timestamp, sourceId)).toThrow("necesita metadata");
  });
});
