export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "No disponible";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function formatBitrate(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps) || bps <= 0) return "No disponible";
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(bps >= 10_000_000 ? 1 : 2)} Mbps`;
  return `${Math.round(bps / 1_000)} kbps`;
}

export function formatFps(fps: number | null): string {
  return fps === null || !Number.isFinite(fps) ? "No disponible" : `${fps.toFixed(3)} FPS`;
}

export function formatSampleRate(hertz: number | null): string {
  return hertz === null ? "No disponible" : `${Number((hertz / 1_000).toFixed(1))} kHz`;
}

export function formatChannels(channels: number | null, layout: string | null): string {
  if (layout) return layout.replace(/\b\w/g, (letter) => letter.toUpperCase());
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  return channels ? `${channels} canales` : "No disponible";
}

export function formatCodec(codec: string | null): string {
  if (!codec) return "No disponible";
  const names: Record<string, string> = { h264: "H.264 / AVC", hevc: "H.265 / HEVC", aac: "AAC", av1: "AV1", vp9: "VP9" };
  return names[codec.toLowerCase()] ?? codec.toUpperCase();
}
