import type { Point } from "./document";

/**
 * Touch gestures of a phone or a tablet, as geometry: what two fingers did between the
 * moment they landed and now, and whether a finger that swept across the screen came in
 * from one of its edges. The shell turns these into zooming the canvas, transforming the
 * selection and opening or closing the side panels.
 */

/** How long a finger must rest without moving before the press counts as a long press. */
export const LONG_PRESS_MS = 550;
/** How far a finger may move, in screen pixels, and still be resting. */
export const LONG_PRESS_SLOP = 10;
/** How near an edge, in screen pixels, a swipe must start to open the panel on that side. */
export const EDGE_ZONE = 24;
/** How far, in screen pixels, a swipe must travel across to count. */
export const SWIPE_DISTANCE = 40;

/** The midpoint, the distance and the angle of the line between two fingers. */
export function pairOf(a: Point, b: Point): { middle: Point; distance: number; angle: number } {
  return {
    middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/**
 * What two fingers did since they landed: how much farther apart they are, how far the
 * line between them turned, in degrees, and how far their midpoint travelled.
 */
export function twoFingerChange(start: [Point, Point], now: [Point, Point]): { scale: number; rotation: number; shift: Point } {
  const from = pairOf(start[0], start[1]), to = pairOf(now[0], now[1]);
  let turn = ((to.angle - from.angle) * 180) / Math.PI;
  // The shortest way round, so a turn across the back of the circle is not a full spin.
  turn = ((((turn + 180) % 360) + 360) % 360) - 180;
  return {
    scale: from.distance > 0 ? to.distance / from.distance : 1,
    rotation: turn,
    shift: { x: to.middle.x - from.middle.x, y: to.middle.y - from.middle.y },
  };
}

/**
 * Where the canvas must sit so the point of the drawing that was under the fingers stays
 * under them after zooming: the new top left corner of the canvas on the screen.
 */
export function zoomAround(canvasOrigin: Point, zoom: number, nextZoom: number, fingers: Point, nextFingers: Point): Point {
  const drawing = { x: (fingers.x - canvasOrigin.x) / zoom, y: (fingers.y - canvasOrigin.y) / zoom };
  return { x: nextFingers.x - drawing.x * nextZoom, y: nextFingers.y - drawing.y * nextZoom };
}

/**
 * Whether a swipe opens or closes a side panel. A swipe inward from the left edge opens
 * the left panel and one from the right edge the right panel; with a panel open, a swipe
 * back toward its edge closes it. Anything more vertical than horizontal is a scroll.
 */
export function edgeSwipe(
  start: Point,
  end: Point,
  width: number,
  open: { left: boolean; right: boolean },
): "openLeft" | "openRight" | "closeLeft" | "closeRight" | null {
  const dx = end.x - start.x, dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.2) return null;
  if (open.left && dx < 0) return "closeLeft";
  if (open.right && dx > 0) return "closeRight";
  if (!open.left && !open.right) {
    if (start.x <= EDGE_ZONE && dx > 0) return "openLeft";
    if (start.x >= width - EDGE_ZONE && dx < 0) return "openRight";
  }
  return null;
}
