export type WorkflowState = "cancelled" | "completed" | "error" | "not_started" | "preparing" | "running";

export interface ProjectManifest {
  createdAt: string;
  edl: { file: "edl.json"; schemaVersion: 1 };
  name: string;
  projectId: string;
  schemaVersion: 1;
  source: {
    fileName: string;
    originalPath: string;
    sourceId: string;
    sourceJson: "source.json";
  };
  updatedAt: string;
  workflow: {
    broll: WorkflowState;
    captions: WorkflowState;
    ingest: WorkflowState;
    render: WorkflowState;
    sceneAnalysis: WorkflowState;
    smartCamera: WorkflowState;
    smartCut: WorkflowState;
    transcription: WorkflowState;
  };
}

export interface SourceManifest {
  audio: {
    bitRate: number | null;
    channelLayout: string | null;
    channels: number | null;
    codec: string | null;
    codecLongName: string | null;
    present: boolean;
    sampleRate: number | null;
  };
  container: { displayName: string; rawName: string | null };
  durationUs: number | null;
  extension: string;
  fileName: string;
  fileSizeBytes: number;
  modifiedAt: string | null;
  path: string;
  schemaVersion: 1;
  sourceId: string;
  streams: {
    audio: number;
    data: number;
    other: number;
    subtitle: number;
    total: number;
    video: number;
  };
  video: {
    bitRate: number | null;
    codec: string | null;
    codecLongName: string | null;
    displayAspectRatio: string | null;
    displayHeight: number | null;
    displayWidth: number | null;
    fps: { decimal: number | null; denominator: number | null; numerator: number | null };
    height: number | null;
    pixelFormat: string | null;
    rotation: number;
    width: number | null;
  };
}

interface TimedTrackItem {
  endUs: number;
  id: string;
  startUs: number;
}

export interface CutDecision extends TimedTrackItem {
  action: string;
  confidence: number | null;
  reason: string | null;
}

export interface CameraDecision extends TimedTrackItem {
  centerX: number | null;
  centerY: number | null;
  confidence: number | null;
  easing: string | null;
  mode: string;
  reason: string | null;
  zoom: number | null;
}

export interface CaptionDecision extends TimedTrackItem {
  styleId: string;
  text: string;
}

export interface BrollDecision extends TimedTrackItem {
  assetPath: string | null;
  confidence: number | null;
  mediaType: "graphic" | "image" | "video";
  reason: string | null;
  source: "external" | "generated" | "local";
}

export interface AudioDecision extends TimedTrackItem {
  operation: string;
  parameters: Record<string, unknown>;
}

export interface EdlManifest {
  output: { aspectRatioMode: "source"; fpsMode: "source"; resolutionMode: "source" };
  projectId: string;
  schemaVersion: 1;
  sourceDurationUs: number | null;
  sourceId: string;
  timebase: { unit: "microseconds" };
  tracks: {
    audio: AudioDecision[];
    broll: BrollDecision[];
    camera: CameraDecision[];
    captions: CaptionDecision[];
    cuts: CutDecision[];
  };
  updatedAt: string;
}

export interface ProjectBundle {
  edl: EdlManifest;
  project: ProjectManifest;
  source: SourceManifest;
}

export type InitializeProjectRequest = ProjectBundle;

export interface ProjectStorageInfo {
  initialized: boolean;
  projectsPath: string;
}

export interface TrackCounts {
  audio: number;
  broll: number;
  camera: number;
  captions: number;
  cuts: number;
}
