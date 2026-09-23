import { createId } from "../lib/id";
import type { VideoMetadata } from "../media/models";
import type { LocalProject } from "../types/project";
import type { InitializeProjectRequest, ProjectBundle, SourceManifest, TrackCounts } from "./contracts";

export function secondsToMicroseconds(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const microseconds = Math.round(seconds * 1_000_000);
  return Number.isSafeInteger(microseconds) ? microseconds : null;
}

function modifiedAt(milliseconds: number | null): string | null {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return null;
  const value = new Date(milliseconds);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export function createSourceManifest(metadata: VideoMetadata, sourceId: string): SourceManifest {
  return {
    schemaVersion: 1,
    sourceId,
    path: metadata.path,
    fileName: metadata.fileName,
    extension: metadata.extension.startsWith(".") ? metadata.extension : `.${metadata.extension}`,
    fileSizeBytes: metadata.sizeBytes,
    modifiedAt: modifiedAt(metadata.lastModifiedMs),
    durationUs: secondsToMicroseconds(metadata.durationSeconds),
    container: metadata.container,
    video: {
      codec: metadata.video.codec,
      codecLongName: metadata.video.codecLongName,
      width: metadata.video.width,
      height: metadata.video.height,
      displayWidth: metadata.video.displayWidth,
      displayHeight: metadata.video.displayHeight,
      fps: {
        numerator: metadata.video.fpsNumerator,
        denominator: metadata.video.fpsDenominator,
        decimal: metadata.video.fpsDecimal,
      },
      pixelFormat: metadata.video.pixelFormat,
      bitRate: metadata.video.bitrateBps,
      rotation: metadata.video.rotation,
      displayAspectRatio: metadata.video.aspectRatio,
    },
    audio: {
      present: metadata.audio.present,
      codec: metadata.audio.codec,
      codecLongName: metadata.audio.codecLongName,
      sampleRate: metadata.audio.sampleRateHz,
      channels: metadata.audio.channels,
      channelLayout: metadata.audio.channelLayout,
      bitRate: metadata.audio.bitrateBps,
    },
    streams: { ...metadata.streams },
  };
}

export function createManifestInitializationRequest(
  project: LocalProject,
  timestamp = new Date().toISOString(),
  sourceId = createId(),
): InitializeProjectRequest {
  if (!project.metadata || !project.source.path) {
    throw new Error("El proyecto necesita metadata y una ruta local antes de crear su manifest.");
  }
  const source = createSourceManifest(project.metadata, sourceId);
  return {
    project: {
      schemaVersion: 1,
      projectId: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: timestamp,
      source: {
        sourceId,
        fileName: source.fileName,
        originalPath: source.path,
        sourceJson: "source.json",
      },
      edl: { schemaVersion: 1, file: "edl.json" },
      workflow: {
        ingest: "completed",
        transcription: "not_started",
        sceneAnalysis: "not_started",
        smartCut: "not_started",
        smartCamera: "not_started",
        captions: "not_started",
        broll: "not_started",
        render: "not_started",
      },
    },
    source,
    edl: {
      schemaVersion: 1,
      projectId: project.id,
      sourceId,
      timebase: { unit: "microseconds" },
      sourceDurationUs: source.durationUs,
      tracks: { cuts: [], camera: [], captions: [], broll: [], audio: [] },
      output: { aspectRatioMode: "source", resolutionMode: "source", fpsMode: "source" },
      updatedAt: timestamp,
    },
  };
}

export function replaceBundleSource(
  bundle: ProjectBundle,
  project: LocalProject,
  timestamp = new Date().toISOString(),
): ProjectBundle {
  if (!project.metadata || !project.source.path) throw new Error("La nueva fuente no contiene metadata válida.");
  const source = createSourceManifest(project.metadata, bundle.source.sourceId);
  return {
    project: {
      ...bundle.project,
      name: project.name,
      updatedAt: timestamp,
      source: { ...bundle.project.source, fileName: source.fileName, originalPath: source.path },
    },
    source,
    edl: { ...bundle.edl, sourceDurationUs: source.durationUs, updatedAt: timestamp },
  };
}

export function countEdlTracks(bundle: ProjectBundle | null): TrackCounts {
  if (!bundle) return { audio: 0, broll: 0, camera: 0, captions: 0, cuts: 0 };
  return {
    audio: bundle.edl.tracks.audio.length,
    broll: bundle.edl.tracks.broll.length,
    camera: bundle.edl.tracks.camera.length,
    captions: bundle.edl.tracks.captions.length,
    cuts: bundle.edl.tracks.cuts.length,
  };
}
