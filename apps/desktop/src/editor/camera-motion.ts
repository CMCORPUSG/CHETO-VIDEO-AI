export interface CameraMotion {
  startUs: number;
  endUs: number;
  transitionUs: number;
  easing?: string | null;
  zoom: number;
  centerX: number;
  centerY: number;
}

export function cameraMotionAt(camera: CameraMotion | null, timeUs: number) {
  if (!camera || timeUs < camera.startUs || timeUs >= camera.endUs) {
    return { zoom: 1, centerX: 0.5, centerY: 0.5 };
  }
  const transition = Math.min(camera.transitionUs, (camera.endUs - camera.startUs) / 2);
  const linear = transition <= 0 ? 1 : Math.max(0, Math.min(1, (timeUs - camera.startUs) / transition, (camera.endUs - timeUs) / transition));
  const factor = camera.easing === "ease_in" ? linear * linear
    : camera.easing === "ease_out" ? 1 - (1 - linear) * (1 - linear)
      : camera.easing === "ease_in_out" ? linear * linear * (3 - 2 * linear)
        : linear;
  return {
    zoom: 1 + (camera.zoom - 1) * factor,
    centerX: 0.5 + (camera.centerX - 0.5) * factor,
    centerY: 0.5 + (camera.centerY - 0.5) * factor,
  };
}

// The base canvas transform stays independent of the timed EDL camera move.
// Rendering applies the camera to the fitted source, then the base transform
// once to the result. This mirrors export::video_filter_chain.
export function composeCanvasAndCamera(baseScale: number, baseOffsetX: number, baseOffsetY: number, motion: ReturnType<typeof cameraMotionAt>) {
  return {
    baseScale: Math.min(2.5, Math.max(0.5, baseScale)),
    baseOffsetX: Math.min(1, Math.max(-1, baseOffsetX)),
    baseOffsetY: Math.min(1, Math.max(-1, baseOffsetY)),
    cameraScale: motion.zoom,
    cameraPanXPercent: (motion.zoom - 1) * (0.5 - motion.centerX) * 100,
    cameraPanYPercent: (motion.zoom - 1) * (0.5 - motion.centerY) * 100,
  };
}
