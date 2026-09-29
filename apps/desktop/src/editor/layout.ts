export type EditorTool = "project" | "cut" | "camera";
export type PreviewSize = "small" | "medium" | "large";
export type AspectMode = "original" | "16:9" | "4:3" | "1:1" | "9:16" | "21:9" | "custom";

export function previewSizeClass(size: PreviewSize): string {
  return { small: "max-w-xl", medium: "max-w-4xl", large: "max-w-none" }[size];
}

export function inspectorFor(tool: EditorTool): EditorTool { return tool; }
export function panelIsVisible(active: EditorTool | null, tool: EditorTool): boolean { return active === tool; }

export function resolveAspectRatio(mode: AspectMode, sourceRatio: number, customWidth = 16, customHeight = 9): number {
  if (mode === "original") return Math.max(0.2, sourceRatio || 16 / 9);
  if (mode === "custom") return Math.max(0.2, customWidth / Math.max(1, customHeight));
  return { "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1, "9:16": 9 / 16, "21:9": 21 / 9 }[mode];
}

export function clampPanelWidth(width: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, width));
}

export function fitViewer(width: number, height: number, aspectRatio: number, viewerScale = 100) {
  if (width <= 0 || height <= 0 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, Math.max(0.35, viewerScale / 100));
  const fittedHeight = Math.min(height, width / aspectRatio) * scale;
  return { width: fittedHeight * aspectRatio, height: fittedHeight };
}

export function canvasTranslationPercent(scale: number, offset: number) {
  return Math.abs(scale - 1) * 50 * Math.min(1, Math.max(-1, offset));
}
