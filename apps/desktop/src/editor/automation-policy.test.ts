import { describe, expect, it } from "vitest";
import { confidenceBand, mayApplyAutomatically, stableDecisionKey } from "./automation-policy";

describe("política de automatización 13D", () => {
  it("genera la misma identidad al reanudar un chunk", () => expect(stableDecisionKey({ sourceId: "s", detector: "click", kind: "sfx", startUs: 100, endUs: 200 })).toBe(stableDecisionKey({ sourceId: "s", detector: "click", kind: "sfx", startUs: 100, endUs: 200 })));
  it("separa las bandas de confianza", () => { expect(confidenceBand(.9)).toBe("high"); expect(confidenceBand(.7)).toBe("medium"); expect(confidenceBand(.2)).toBe("low"); });
  it("solo aplica automático tras validación y sin conflicto", () => { const base={mode:"automatic" as const,confidence:.9,validationPassed:true,conflictFree:true,idempotent:true,manualOverride:false}; expect(mayApplyAutomatically(base)).toBe(true); expect(mayApplyAutomatically({...base,conflictFree:false})).toBe(false); expect(mayApplyAutomatically({...base,confidence:.7})).toBe(false); expect(mayApplyAutomatically({...base,mode:"assisted"})).toBe(false); });
});
