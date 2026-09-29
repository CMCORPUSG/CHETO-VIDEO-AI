import type { CutDecision, EdlManifest } from "../project/contracts";

const START_ID = "manual-trim-source-start";
const END_ID = "manual-trim-source-end";
const MIN_CLIP_US = 100_000;

export function clipBounds(edl: EdlManifest, durationUs: number) {
  const trim = edl.manualTrim;
  return {
    sourceInUs: Math.max(0, Math.min(durationUs, trim?.sourceInUs ?? 0)),
    sourceOutUs: Math.max(0, Math.min(durationUs, trim?.sourceOutUs ?? durationUs)),
  };
}

export function applyManualTrim(edl: EdlManifest, durationUs: number, sourceInUs: number, sourceOutUs: number): EdlManifest | null {
  const start = Math.round(Math.max(0, Math.min(durationUs, sourceInUs)));
  const end = Math.round(Math.max(0, Math.min(durationUs, sourceOutUs)));
  if (end - start < MIN_CLIP_US) return null;
  const manualCut = (id: string, startUs: number, endUs: number): CutDecision => ({
    id, startUs, endUs, action: "remove", confidence: null, reason: "Recorte manual del clip",
  });
  const cuts = edl.tracks.cuts.filter(cut => cut.id !== START_ID && cut.id !== END_ID);
  if (start > 0) cuts.push(manualCut(START_ID, 0, start));
  if (end < durationUs) cuts.push(manualCut(END_ID, end, durationUs));
  return {
    ...edl,
    manualTrim: { sourceInUs: start, sourceOutUs: end },
    manualSplitPointsUs: (edl.manualSplitPointsUs ?? []).filter(value => value > start && value < end),
    tracks: { ...edl.tracks, cuts },
  };
}

export function splitManualClip(edl: EdlManifest, durationUs: number, sourceUs: number): EdlManifest | null {
  const { sourceInUs, sourceOutUs } = clipBounds(edl, durationUs);
  const at = Math.round(sourceUs);
  if (at - sourceInUs < MIN_CLIP_US || sourceOutUs - at < MIN_CLIP_US) return null;
  if ((edl.manualSplitPointsUs ?? []).includes(at)) return null;
  return { ...edl, manualSplitPointsUs: [...(edl.manualSplitPointsUs ?? []), at].sort((a, b) => a - b) };
}

export function manualClipSegments(edl: EdlManifest, durationUs: number) {
  const { sourceInUs, sourceOutUs } = clipBounds(edl, durationUs);
  const points = [sourceInUs, ...(edl.manualSplitPointsUs ?? []).filter(value => value > sourceInUs && value < sourceOutUs).sort((a,b) => a-b), sourceOutUs];
  return points.slice(0, -1).map((startUs, index) => ({ id: `source-${index}`, startUs, endUs: points[index + 1] }));
}
