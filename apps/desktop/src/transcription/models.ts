export type QualityMode = "auto" | "fast" | "balanced" | "quality";
export type LanguageMode = "auto" | "es" | "en";
export type ModelState = "not_installed" | "downloading" | "verifying" | "ready" | "invalid" | "error";
export type TranscriptState = "not_created" | "preparing" | "running" | "completed" | "cancelled" | "error" | "stale";

export interface GpuAdapter { dedicatedVideoMemoryBytes: number; deviceId: number; name: string; vendor: string; vendorId: number }
export interface HardwareProfile { architecture: string; cpu: string; diskFreeBytes: number; gpuAdapters: GpuAdapter[]; logicalCores: number; physicalCores: number; ramAvailableBytes: number; ramTotalBytes: number; transcriptionAcceleration: { available: boolean; backend: string; computeTypes: string[]; reason: string } }
export interface ExecutionProfile { automatic: boolean; computeType: string; cpuThreads: number; device: string; model: string; reason: string; workers: number }
export interface ModelStatus { estimatedSizeBytes: number | null; message: string | null; model: string; path: string; state: ModelState }
export interface TranscriptSegment { avgLogProb: number | null; endUs: number | null; id: string; noSpeechProb: number | null; startUs: number | null; text: string; words: { endUs: number | null; id: string; probability: number | null; startUs: number | null; text: string }[] }
export interface TranscriptStatus { durationUs: number; engine: { computeType: string; device: string; model: string; name: string } | null; language: string | null; message: string | null; processedUs: number; progress: number | null; segmentCount: number; segments: TranscriptSegment[]; state: TranscriptState; wordCount: number }
export interface TranscriptionEvent { event: string; payload: Record<string, unknown>; projectId: string }

export function hardwareSummary(profile: HardwareProfile): string { return profile.gpuAdapters[0]?.name ?? profile.cpu; }
export function transcriptProgress(processedUs: number, durationUs: number): number { return durationUs <= 0 ? 0 : Math.min(100, Math.max(0, processedUs / durationUs * 100)); }
export function countTranscriptWords(segments: TranscriptSegment[]): number { return segments.reduce((sum, segment) => sum + segment.words.length, 0); }
export function segmentSeekTarget(segment: TranscriptSegment): number | null { return segment.startUs; }
