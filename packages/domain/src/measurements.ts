/** Geometry remains in CSS pixels; units change presentation only. */
export type Unit = "px" | "pt" | "mm" | "cm" | "in" | "ft";
export const measurementUnits: readonly Unit[] = ["px", "pt", "mm", "cm", "in", "ft"];
const pixelsPerUnit: Record<Unit, number> = { px: 1, pt: 96 / 72, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, ft: 1152 };
export function isUnit(value: unknown): value is Unit {
  return typeof value === "string" && measurementUnits.includes(value as Unit);
}
export function toPixels(value: number, unit: Unit): number {
  if (!Number.isFinite(value) || !isUnit(unit)) throw new Error("Invalid measurement");
  return value * pixelsPerUnit[unit];
}
export function fromPixels(value: number, unit: Unit): number {
  if (!Number.isFinite(value) || !isUnit(unit)) throw new Error("Invalid measurement");
  return value / pixelsPerUnit[unit];
}
export function formatMeasurement(value: number, unit: Unit): string {
  return Number(fromPixels(value, unit).toFixed(3)).toString();
}
export interface RulerTick { position: number; label: string; major: boolean }
export function rulerTicks(lengthPx: number, zoom: number, unit: Unit, stepPx: number, minorStepPx?: number): RulerTick[] {
  if (![lengthPx, zoom, stepPx].every(Number.isFinite) || lengthPx < 0 || zoom <= 0 || stepPx <= 0 || !isUnit(unit)) return [];
  const hasMinor = minorStepPx !== undefined && Number.isFinite(minorStepPx) && minorStepPx > 0;
  const ticks: RulerTick[] = [];
  const limit = hasMinor ? 500 : 1000;
  const append = (interval: number, major: boolean) => {
    // Display decimation never changes the intervals used by magnetic snapping.
    const stride = Math.max(1, Math.ceil((major ? 45 : 4) / (interval * zoom)), Math.ceil(lengthPx / interval / (limit - 1)));
    const step = interval * stride;
    if (!Number.isFinite(step)) { if (major) ticks.push({ position: 0, label: "0", major: true }); return; }
    const count = Math.min(limit, Math.floor(lengthPx / step) + 1);
    for (let index = 0; index < count; index++) {
      const position = index * step;
      const onMajor = Math.abs(position / stepPx - Math.round(position / stepPx)) < 1e-8;
      // Coincident ticks remain major, even when their label has been thinned.
      if (!major && ticks.some((tick) => Math.abs(tick.position - position) * zoom < 0.01)) continue;
      ticks.push({ position, label: major ? formatMeasurement(position, unit) : "", major: major || onMajor });
    }
  };
  append(stepPx, true);
  if (hasMinor) append(minorStepPx!, false);
  return ticks.sort((a, b) => a.position - b.position);
}
export interface SnapScale { enabled: boolean; visible: boolean; step: number; radius: number }
export interface RulerSnapScale extends SnapScale { minorStep?: number; majorEnabled?: boolean; minorEnabled?: boolean }
/** Missing interval switches preserve the previous major-only behavior. */
export function rulerSnapSteps(scale: RulerSnapScale): number[] {
  if (!scale.enabled || !scale.visible) return [];
  return [scale.majorEnabled !== false ? scale.step : 0, scale.minorEnabled ? scale.minorStep ?? 0 : 0]
    .filter((step) => Number.isFinite(step) && step > 0);
}
export interface SnapConfig {
  zoom: number;
  rulers: RulerSnapScale;
  grid: SnapScale;
  guides: { enabled: boolean; visible: boolean; radius: number; items: readonly { axis: "x" | "y"; position: number }[] };
}
export function snapPoint<T extends { x: number; y: number }>(point: T, config: SnapConfig): T {
  if (!Number.isFinite(config.zoom) || config.zoom <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { ...point };
  const nearest = (axis: "x" | "y"): number => {
    let result = point[axis];
    let distance = Infinity;
    const consider = (candidate: number, radius: number) => {
      const delta = Math.abs(candidate - point[axis]);
      if (Number.isFinite(candidate) && Number.isFinite(radius) && radius >= 0 && delta <= radius / config.zoom && delta < distance) {
        result = candidate;
        distance = delta;
      }
    };
    if (config.guides.enabled && config.guides.visible) {
      for (const guide of config.guides.items) if (guide.axis === axis) consider(guide.position, config.guides.radius);
    }
    for (const step of rulerSnapSteps(config.rulers))
      consider(Math.round(point[axis] / step) * step, config.rulers.radius);
    const grid = config.grid;
    if (grid.enabled && grid.visible && Number.isFinite(grid.step) && grid.step > 0)
      consider(Math.round(point[axis] / grid.step) * grid.step, grid.radius);
    return result;
  };
  return { ...point, x: nearest("x"), y: nearest("y") };
}
