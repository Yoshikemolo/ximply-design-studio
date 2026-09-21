export function canvasWheelZoom(current: number, delta: number): number {
  return Math.min(
    3,
    Math.max(
      0.1,
      current * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002),
    ),
  );
}
export function isCanvasZoomGesture(
  control: boolean,
  space: boolean,
  editing: boolean,
): boolean {
  return control && space && !editing;
}
