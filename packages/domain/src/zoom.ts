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

/** A rectangle in screen pixels, as a bounding client rect gives it. */
export interface ScreenRect { left: number; top: number; width: number; height: number }

/**
 * The part of the page seen through the viewport, to draw sharp at the screen's resolution
 * once the view is still: the page region in page units with the scale that gives one canvas
 * pixel per device pixel, and where that canvas goes over the page canvas, in CSS pixels from
 * its top left corner. Null when the page is not magnified on screen (one page unit is at most
 * one device pixel) or when none of it is in view. The scale is lowered so the canvas never
 * holds more than `maxPixels`.
 */
export function detailRegion(page: ScreenRect, view: ScreenRect, zoom: number, pixelRatio: number, maxPixels = 16_000_000) {
  if (!(zoom > 0) || zoom * pixelRatio <= 1 + 1e-6) return null;
  const left = Math.max(0, Math.floor(view.left - page.left));
  const top = Math.max(0, Math.floor(view.top - page.top));
  const right = Math.min(page.width, Math.ceil(view.left + view.width - page.left));
  const bottom = Math.min(page.height, Math.ceil(view.top + view.height - page.top));
  const width = right - left, height = bottom - top;
  if (width < 1 || height < 1) return null;
  const scale = Math.min(zoom * pixelRatio, Math.sqrt(maxPixels / (width * height)) * zoom);
  return {
    page: { x: left / zoom, y: top / zoom, width: width / zoom, height: height / zoom, scale },
    css: { left, top, width, height },
  };
}
