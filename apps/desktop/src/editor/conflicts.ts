import type { CameraDecision, CutDecision } from "../project/contracts";
import type { CameraSuggestion } from "../smart-camera/models";
import type { SmartCutSuggestion } from "../smart-cut/models";

export const TEMPORAL_EPSILON_US = 75_000;
export const CUT_AUTO_MERGE_OVERLAP_US = 250_000;

type Range = { id: string; startUs: number; endUs: number };
export type IntervalRelation = "new" | "duplicate" | "contained" | "contains" | "touching" | "overlap" | "conflict";
export type ConflictClass = "new" | "duplicate" | "contained" | "contains" | "mergeable" | "overlap" | "conflict";
export type Resolution = "merge" | "replace" | "keep_existing" | "trim_new";

export function overlapUs(next: Range, current: Range): number {
  return Math.max(0, Math.min(next.endUs, current.endUs) - Math.max(next.startUs, current.startUs));
}

export function classifyInterval(next: Range, current: Range): IntervalRelation {
  if (next.startUs >= next.endUs || current.startUs >= current.endUs) return "conflict";
  if (Math.abs(next.startUs - current.startUs) <= TEMPORAL_EPSILON_US && Math.abs(next.endUs - current.endUs) <= TEMPORAL_EPSILON_US) return "duplicate";
  if (next.endUs < current.startUs - TEMPORAL_EPSILON_US || current.endUs < next.startUs - TEMPORAL_EPSILON_US) return "new";
  if (overlapUs(next, current) === 0) return "touching";
  if (next.startUs >= current.startUs - TEMPORAL_EPSILON_US && next.endUs <= current.endUs + TEMPORAL_EPSILON_US) return "contained";
  if (next.startUs <= current.startUs + TEMPORAL_EPSILON_US && next.endUs >= current.endUs - TEMPORAL_EPSILON_US) return "contains";
  return "overlap";
}

export function classifyCut(next: Range, current: Range & { action?: string }): ConflictClass {
  const relation = classifyInterval(next, current);
  if (relation === "new" || relation === "conflict") return relation;
  if (current.action && current.action !== "remove") return "conflict";
  if (relation === "duplicate" || relation === "contained" || relation === "contains") return relation;
  return overlapUs(next, current) <= CUT_AUTO_MERGE_OVERLAP_US ? "mergeable" : "overlap";
}

type CameraRange = CameraDecision | CameraSuggestion;
function sameCameraEffect(left: CameraRange, right: CameraRange): boolean {
  const mode = (value: CameraRange) => "mode" in value ? value.mode : value.suggestionType;
  const transition = (value: CameraRange) => value.transitionUs ?? 0;
  const easing = (value: CameraRange) => "easing" in value ? value.easing ?? "ease_in_out" : "ease_in_out";
  return mode(left) === mode(right)
    && Math.abs((left.zoom ?? 1) - (right.zoom ?? 1)) <= 0.01
    && Math.abs((left.centerX ?? 0.5) - (right.centerX ?? 0.5)) <= 0.02
    && Math.abs((left.centerY ?? 0.5) - (right.centerY ?? 0.5)) <= 0.02
    && Math.abs(transition(left) - transition(right)) <= TEMPORAL_EPSILON_US
    && easing(left) === easing(right);
}

export function classifyCamera(next: CameraSuggestion, current: CameraRange): ConflictClass {
  const relation = classifyInterval(next, current);
  if (relation === "new" || relation === "touching") return "new";
  if (relation === "conflict") return "conflict";
  if (!sameCameraEffect(next, current)) return "conflict";
  if (relation === "duplicate" || relation === "contained") return relation;
  return "overlap";
}

export interface BatchEntry<P, E> { proposal: P; existing: E | null; classification: ConflictClass; overlapUs: number }
export interface BatchCounts { new: number; duplicate: number; contained: number; contains: number; mergeable: number; overlap: number; conflict: number }
const emptyCounts = (): BatchCounts => ({ new: 0, duplicate: 0, contained: 0, contains: 0, mergeable: 0, overlap: 0, conflict: 0 });
const priority: ConflictClass[] = ["conflict", "overlap", "duplicate", "contained", "contains", "mergeable", "new"];
function strongest<E>(matches: { existing: E; classification: ConflictClass }[]) {
  return matches.sort((a, b) => priority.indexOf(a.classification) - priority.indexOf(b.classification))[0];
}

export function previewCuts(suggestions: SmartCutSuggestion[], current: CutDecision[]) {
  const counts = emptyCounts();
  const entries: BatchEntry<SmartCutSuggestion, CutDecision>[] = [];
  const working = [...current].sort((a, b) => a.startUs - b.startUs);
  for (const proposal of suggestions.filter((item) => item.status === "accepted").sort((a, b) => a.startUs - b.startUs)) {
    const byId = working.find((item) => item.id === proposal.id);
    const matches = byId ? [{ existing: byId, classification: "duplicate" as ConflictClass }]
      : working.filter((item) => item.startUs <= proposal.endUs + TEMPORAL_EPSILON_US && item.endUs >= proposal.startUs - TEMPORAL_EPSILON_US)
        .map((existing) => ({ existing, classification: classifyCut(proposal, existing) })).filter((item) => item.classification !== "new");
    const strongestMatch = strongest(matches);
    const classification = strongestMatch?.classification ?? "new";
    counts[classification]++;
    entries.push({ proposal, existing: strongestMatch?.existing ?? null, classification, overlapUs: strongestMatch ? overlapUs(proposal, strongestMatch.existing) : 0 });
    if (["new", "contains", "mergeable"].includes(classification)) {
      const merge = matches.map((item) => item.existing);
      const merged: CutDecision = { id: merge[0]?.id ?? proposal.id, action: "remove", confidence: proposal.confidence, reason: proposal.reason, startUs: Math.min(proposal.startUs, ...merge.map((item) => item.startUs)), endUs: Math.max(proposal.endUs, ...merge.map((item) => item.endUs)) };
      for (const item of merge) working.splice(working.indexOf(item), 1);
      working.push(merged);
      working.sort((a, b) => a.startUs - b.startUs);
    }
  }
  return { counts, entries, conflicts: entries.filter((item) => item.classification === "overlap" || item.classification === "conflict") };
}

export function previewCamera(suggestions: CameraSuggestion[], current: CameraDecision[]) {
  const counts = emptyCounts();
  const entries: BatchEntry<CameraSuggestion, CameraRange>[] = [];
  const working: CameraRange[] = [...current].sort((a, b) => a.startUs - b.startUs);
  for (const proposal of suggestions.filter((item) => item.status === "accepted").sort((a, b) => a.startUs - b.startUs)) {
    const byId = working.find((item) => item.id === proposal.id);
    const matches = byId ? [{ existing: byId, classification: "duplicate" as ConflictClass }]
      : working.filter((item) => item.startUs < proposal.endUs + TEMPORAL_EPSILON_US && item.endUs > proposal.startUs - TEMPORAL_EPSILON_US)
        .map((existing) => ({ existing, classification: classifyCamera(proposal, existing) })).filter((item) => item.classification !== "new");
    const strongestMatch = strongest(matches);
    const classification = strongestMatch?.classification ?? "new";
    counts[classification]++;
    entries.push({ proposal, existing: strongestMatch?.existing ?? null, classification, overlapUs: strongestMatch ? overlapUs(proposal, strongestMatch.existing) : 0 });
    if (classification === "new") { working.push(proposal); working.sort((a, b) => a.startUs - b.startUs); }
  }
  return { counts, entries, conflicts: entries.filter((item) => item.classification === "overlap" || item.classification === "conflict") };
}
