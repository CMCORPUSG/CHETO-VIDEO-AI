import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/ffprobe-standard.json";
import { formatBitrate, formatDuration } from "./format";
import { normalizeProbe, parseFrameRate, resolveAspectRatio } from "./normalize";

const source = {
  fileName: "curso programación (2026).mp4",
  lastModifiedMs: 1_760_000_000_000,
  path: "D:\\Mis Videos\\curso programación (2026).mp4",
  sizeBytes: 9_040_901_734,
};

describe("normalización FFprobe", () => {
  it("convierte FPS racionales sin redondear su valor interno", () => {
    expect(parseFrameRate("60000/1001")).toEqual({ numerator: 60000, denominator: 1001, decimal: 60000 / 1001 });
    expect(parseFrameRate("30000/1001").decimal).toBeCloseTo(29.970, 3);
    expect(parseFrameRate("0/0").decimal).toBeNull();
  });

  it("formatea duración y bitrate para UI", () => {
    expect(formatDuration(6137.245)).toBe("01:42:17");
    expect(formatBitrate(14_800_000)).toBe("14.8 Mbps");
    expect(formatBitrate(192_000)).toBe("192 kbps");
    expect(formatBitrate(null)).toBe("No disponible");
  });

  it("respeta display aspect ratio y rotación", () => {
    expect(resolveAspectRatio(1440, 1080, "16:9")).toBe("16:9");
    expect(resolveAspectRatio(1920, 1080, "16:9", 90)).toBe("9:16");
    expect(resolveAspectRatio(1080, 1080)).toBe("1:1");
  });

  it("normaliza la fixture completa y conserva valores técnicos", () => {
    const metadata = normalizeProbe(fixture, source);
    expect(metadata.durationSeconds).toBe(6137.245);
    expect(metadata.video).toMatchObject({
      aspectRatio: "16:9",
      bitrateBps: 14_800_000,
      codec: "h264",
      displayHeight: 1080,
      displayWidth: 1920,
      fpsDenominator: 1001,
      fpsNumerator: 60000,
    });
    expect(metadata.audio).toMatchObject({ present: true, codec: "aac", sampleRateHz: 48000, channels: 2 });
    expect(metadata.streams).toEqual({ audio: 1, data: 0, other: 0, total: 2, video: 1 });
    expect(metadata.container.displayName).toBe("MP4");
    expect(metadata.path).toBe("D:\\Mis Videos\\curso programación (2026).mp4");
  });

  it("normaliza un video vertical definido por display matrix", () => {
    const metadata = normalizeProbe({
      streams: [{
        codec_type: "video",
        width: 1920,
        height: 1080,
        display_aspect_ratio: "16:9",
        avg_frame_rate: "30/1",
        side_data_list: [{ rotation: -90 }],
      }],
      format: { duration: "12.5", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
    }, source);
    expect(metadata.video).toMatchObject({ displayWidth: 1080, displayHeight: 1920, aspectRatio: "9:16", rotation: -90 });
  });

  it("tolera video sin audio", () => {
    const metadata = normalizeProbe({ streams: [fixture.streams[0]], format: fixture.format }, source);
    expect(metadata.audio).toEqual({
      bitrateBps: null,
      channelLayout: null,
      channels: null,
      codec: null,
      codecLongName: null,
      present: false,
      sampleRateHz: null,
    });
    expect(metadata.streams.audio).toBe(0);
  });

  it("tolera campos opcionales ausentes y rechaza archivos sin video", () => {
    const metadata = normalizeProbe({ streams: [{ codec_type: "video", codec_name: "av1" }] }, source);
    expect(metadata.durationSeconds).toBeNull();
    expect(metadata.video.width).toBeNull();
    expect(metadata.video.fpsDecimal).toBeNull();
    expect(() => normalizeProbe({ streams: [{ codec_type: "audio", codec_name: "aac" }] }, source)).toThrow(
      "pista de video",
    );
  });
});
