import { describe, expect, it } from "vitest";
import { clampTitleToSafeArea, createTitle, titleFrame, titlePositionForAspect, TITLE_PRESETS } from "./titles";

describe("títulos deterministas", () => {
  it("ofrece 18 familias con categorías y compatibilidad", () => {
    expect(TITLE_PRESETS).toHaveLength(18);
    expect(new Set(TITLE_PRESETS.map(item => item.id)).size).toBe(18);
    expect(TITLE_PRESETS.every(item => item.category && item.mechanism && item.recommendedAspectRatios.length)).toBe(true);
  });
  it("conserva Unicode íntegro en el EDL y una revelación determinista", () => {
    const phrase = "José — Configuración y Música: ¡Celebración en Perú! ¿Qué hacemos? ÁÉÍÓÚ áéíóú ñ Ñ";
    const title = { ...createTitle("typewriter-tech", 0, 10_000_000), text: phrase };
    const restored: unknown = JSON.parse(JSON.stringify(title));
    expect(restored).toMatchObject({ text: phrase });
    expect(titleFrame(title, 250_000)?.revealedCharacters).toBe(titleFrame(title, 250_000)?.revealedCharacters);
  });
  it("conserva el mismo estado al volver al mismo timestamp", () => {
    const title = createTitle("rise-settle", 1_000_000, 10_000_000);
    const first = titleFrame(title, 1_250_000);
    titleFrame(title, 3_000_000);
    expect(titleFrame(title, 1_250_000)).toEqual(first);
    expect(titleFrame(title, 500_000)).toBeNull();
  });
  it("calcula inicio, mitad, salida y safe area", () => {
    const title = createTitle("zoom-out-stat", 0, 10_000_000);
    expect(titleFrame(title, 0)?.opacity).toBe(0);
    expect(titleFrame(title, 250_000)?.scale).toBeGreaterThan(1);
    expect(titleFrame(title, 1_000_000)?.scale).toBe(1);
    expect(titleFrame(title, title.endUs - 100_000)?.opacity).toBeLessThan(1);
    expect(clampTitleToSafeArea({ ...title, positionX: 0, positionY: 1 })).toMatchObject({ positionX: 0.06, positionY: 0.94 });
    expect(titlePositionForAspect({ ...title, positionX: 0, positionY: 1 }, 9/16)).toEqual({ x: 0.1, y: 0.86 });
  });
});
