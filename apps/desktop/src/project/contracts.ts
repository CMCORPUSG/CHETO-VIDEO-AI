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
    ingest: WorkflowState;
    render: WorkflowState;
    sceneAnalysis: WorkflowState;
    smartCamera: WorkflowState;
    smartCut: WorkflowState;
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

export type AutomationMode = "assisted" | "automatic";
export type DecisionOrigin = "manual" | "automatic" | "proposal";
export interface AutomationDecisionMeta {
  key: string;
  detector: string;
  detectorVersion: string;
  ruleVersion?: string;
  origin: DecisionOrigin;
  confidence: number | null;
  manualAction?: "accepted" | "rejected" | "modified";
}

interface TimedTrackItem {
  endUs: number;
  id: string;
  startUs: number;
  automation?: AutomationDecisionMeta;
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
  transitionUs?: number | null;
  zoom: number | null;
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

export interface AssetDecision extends TimedTrackItem {
  assetId: string;
  assetPath: string;
  sourceDurationUs: number;
  kind: "sfx" | "music" | "overlay";
  gainDb: number;
  fadeInUs: number;
  fadeOutUs: number;
  loop: boolean;
  ducking: boolean;
  duckDb: number;
  attackMs: number;
  releaseMs: number;
  positionX: number;
  positionY: number;
  scale: number;
  opacity: number;
  muted: boolean;
}

export type TitlePresetId = "whisper-fade" | "rise-settle" | "stack-reveal" | "mask-wipe-up" | "split-line" | "underline-sweep" | "lower-third" | "zoom-out-stat" | "callout"
  | "editorial-master" | "future-glow" | "content-create" | "neon-statement" | "kinetic-pop" | "letter-cascade-pro" | "dynamic-slide" | "typewriter-tech" | "word-highlight" | "split-impact" | "stacked-reveal-pro" | "underline-editorial" | "lower-third-premium" | "stat-hero" | "tutorial-step" | "quote-editorial" | "gaming-impact" | "corporate-clean";
export interface TitleLayoutOverride { x?: number; y?: number; scale?: number; rotation?: number; maxWidth?: number }
export interface TitleLayerOverride {
  text?: string;
  font?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  case?: "original" | "upper" | "lower" | "title";
  fill?: string;
  alignment?: "left" | "center" | "right";
  letterSpacing?: number;
  lineHeight?: number;
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowOpacity?: number;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  glowColor?: string;
  glowIntensity?: number;
  opacity?: number;
  layoutOverrides?: Partial<Record<import("../templates/registry").TemplateVariant, TitleLayoutOverride>>;
}
export interface TitleDecision extends TimedTrackItem {
  instanceId?: string;
  templateId?: string;
  templateVersion?: string;
  parameters?: Record<string, string | number | boolean>;
  templateSnapshot?: import("../templates/registry").TemplateManifest;
  layerOverrides?: Record<string, TitleLayerOverride>;
  layoutOverrides?: Partial<Record<import("../templates/registry").TemplateVariant, TitleLayoutOverride>>;
  presetId: TitlePresetId;
  text: string;
  secondaryText: string;
  descriptionText?: string;
  positionX: number;
  positionY: number;
  anchor: "center" | "left" | "right";
  scale: number;
  font: string;
  fontWeight: number;
  fontSize: number;
  color: string;
  accentColor: string;
  alignment: "left" | "center" | "right";
  tracking: number;
  lineHeight: number;
  opacity: number;
  safeArea: number;
  animationInUs: number;
  animationOutUs: number;
  easing: "linear" | "ease-out";
  background: boolean;
}

export type TransitionKind = "fade-black" | "cross-dissolve" | "push" | "slide-wipe" | "whip-pan" | "zoom";
export interface TransitionDecision {
  id: string;
  kind: TransitionKind;
  atUs: number;
  durationUs: number;
}

export interface EdlManifest {
  manualTrim?: { sourceInUs: number; sourceOutUs: number };
  manualSplitPointsUs?: number[];
  audioOnTimeline?: boolean;
  automation?: { mode: AutomationMode; rulesVersion: string };
  output: { aspectRatioMode: "source"; fpsMode: "source"; resolutionMode: "source" };
  projectId: string;
  schemaVersion: 1;
  sourceDurationUs: number | null;
  sourceOnTimeline?: boolean;
  sourceId: string;
  timebase: { unit: "microseconds" };
  tracks: {
    audio: AudioDecision[];
    assets?: AssetDecision[];
    titles?: TitleDecision[];
    transitions?: TransitionDecision[];
    broll: BrollDecision[];
    camera: CameraDecision[];
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
  cuts: number;
}
