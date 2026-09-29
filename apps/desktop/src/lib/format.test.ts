import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDisplayDate, formatLogTime } from "./format";

describe("regional date and time preferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the selected region, timezone and display formats", () => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ locale: "es-MX", timezone: "America/Mexico_City", dateFormat: "mdy", timeFormat: "12" }) });
    const timestamp = new Date("2026-09-27T18:30:00Z");
    expect(formatDisplayDate(timestamp)).toBe("09/27/2026");
    expect(formatLogTime(timestamp.toISOString())).toMatch(/12:30:00/);
  });
});
