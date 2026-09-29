import type { WaveformView } from "./visuals";

export function amplitudeDb(amplitude: number): string {
  if (amplitude <= 0) return "−∞ dB";
  return `${(20 * Math.log10(amplitude)).toFixed(1)} dB`;
}

export function audioLevels(view: WaveformView) {
  const peak = Math.max(0, ...view.peaks);
  const meanSquare = view.rms.reduce((sum, value) => sum + value * value, 0) / Math.max(1, view.rms.length);
  return { peakDb: amplitudeDb(peak), averageDb: amplitudeDb(Math.sqrt(meanSquare)) };
}
