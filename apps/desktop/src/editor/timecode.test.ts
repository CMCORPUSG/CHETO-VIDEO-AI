import { describe, expect, it } from "vitest";
import { formatTimecode, parseTimecode } from "./timecode";

describe("professional timecode", () => {
  it.each([[0,"00:00:00.000"],[58_618_000,"00:00:58.618"],[3_599_999_000,"00:59:59.999"],[3_600_000_000,"01:00:00.000"],[7_200_000_000,"02:00:00.000"]])("formats %i microseconds", (us, expected) => expect(formatTimecode(us)).toBe(expected));
  it.each([["12.350",12_350_000],["00:12.350",12_350_000],["00:00:12.350",12_350_000]])("parses %s", (value, expected) => expect(parseTimecode(value)).toBe(expected));
  it("rejects invalid ranges", () => expect(parseTimecode("00:61.000")).toBeNull());
});
