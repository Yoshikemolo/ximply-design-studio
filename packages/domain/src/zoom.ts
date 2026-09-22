/**
 * The zoom levels a click of the Zoom tool, View > Zoom In and View > Zoom Out step
 * through, as Illustrator's presets do, within the range this editor draws at.
 */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3;
export const ZOOM_PRESETS = [0.03125, 0.0417, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]
  .filter((zoom) => zoom >= ZOOM_MIN && zoom <= ZOOM_MAX);

/** The next preset above the current zoom when zooming in, or below it when zooming out. */
export function stepZoom(current: number, direction: "in" | "out"): number {
  const epsilon = 1e-3;
  if (direction === "in") return ZOOM_PRESETS.find((zoom) => zoom > current + epsilon) ?? ZOOM_MAX;
  return [...ZOOM_PRESETS].reverse().find((zoom) => zoom < current - epsilon) ?? ZOOM_MIN;
}
