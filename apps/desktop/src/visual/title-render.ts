export const TITLE_RENDER_IDLE_MS = 550;

export function createTitleRenderGate(onIdle: () => void, delayMs = TITLE_RENDER_IDLE_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  return {
    schedule() {
      const requested = ++generation;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (requested === generation) onIdle();
      }, delayMs);
    },
    cancel() {
      generation += 1;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
