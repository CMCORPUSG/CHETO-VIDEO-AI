import type { AutomationDecisionMeta, AutomationMode, EdlManifest } from "../project/contracts";

export const AUTOMATION_RULES_VERSION = "13d-policy-v1";

export function stableDecisionKey(input: {
  sourceId: string;
  detector: string;
  detectorVersion?: string;
  kind: string;
  startUs: number;
  endUs: number;
  config?: string;
}) {
  const value = [input.sourceId, input.detector, input.detectorVersion ?? AUTOMATION_RULES_VERSION, input.kind, input.startUs, input.endUs, input.config ?? ""].join("|");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `auto:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function decisionMeta(sourceId: string, detector: string, kind: string, startUs: number, endUs: number, confidence: number | null, config?: string): AutomationDecisionMeta {
  return { key: stableDecisionKey({ sourceId, detector, kind, startUs, endUs, config }), detector, detectorVersion: AUTOMATION_RULES_VERSION, origin: "proposal", confidence };
}

export function confidenceBand(confidence: number | null): "high" | "medium" | "low" {
  if (confidence !== null && confidence >= 0.85) return "high";
  if (confidence !== null && confidence >= 0.6) return "medium";
  return "low";
}

export function mayApplyAutomatically(input: { mode: AutomationMode; confidence: number | null; validationPassed: boolean; conflictFree: boolean; idempotent: boolean; manualOverride: boolean }) {
  return input.mode === "automatic" && confidenceBand(input.confidence) === "high" && input.validationPassed && input.conflictFree && input.idempotent && !input.manualOverride;
}

export function hasEquivalentDecision(edl: EdlManifest, key: string) {
  return Object.values(edl.tracks).flat().some(item => item && typeof item === "object" && "automation" in item && item.automation?.key === key);
}

export function rememberManualDecision(meta: AutomationDecisionMeta, action: "accepted" | "rejected" | "modified"): AutomationDecisionMeta {
  return { ...meta, origin: action === "accepted" ? "automatic" : "manual", manualAction: action };
}

