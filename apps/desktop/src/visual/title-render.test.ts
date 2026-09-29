import { afterEach, describe, expect, it, vi } from "vitest";
import { createTitleRenderGate } from "./title-render";

afterEach(() => vi.useRealTimers());

describe("title render gate", () => {
  it("waits for idle and cancels stale title renders", () => {
    vi.useFakeTimers();
    const render = vi.fn();
    const gate = createTitleRenderGate(render, 550);
    gate.schedule();
    vi.advanceTimersByTime(300);
    gate.schedule();
    vi.advanceTimersByTime(300);
    expect(render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(render).toHaveBeenCalledTimes(1);
    gate.schedule();
    gate.cancel();
    vi.runAllTimers();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
