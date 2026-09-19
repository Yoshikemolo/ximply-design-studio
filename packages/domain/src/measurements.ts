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
export function rulerTicks(lengthPx: number, zoom: number, unit: Unit, stepPx: number): RulerTick[] {
  if (![lengthPx, zoom, stepPx].every(Number.isFinite) || lengthPx < 0 || zoom <= 0 || stepPx <= 0 || !isUnit(unit)) return [];
  // Decimate crowded ticks while keeping them on the configured ruler scale.
  const stride = Math.max(1, Math.ceil(45 / (stepPx * zoom)), Math.ceil(lengthPx / stepPx / 999));
  const step = stepPx * stride;
  if (!Number.isFinite(step)) return [{ position: 0, label: "0", major: true }];
  const count = Math.min(1000, Math.floor(lengthPx / step) + 1);
  return Array.from({ length: count }, (_, index) => ({ position: index * step, label: formatMeasurement(index * step, unit), major: true }));
}
export interface SnapScale { enabled: boolean; visible: boolean; step: number; radius: number }
export interface SnapConfig {
  zoom: number;
  rulers: SnapScale;
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
    for (const scale of [config.rulers, config.grid]) {
      if (scale.enabled && scale.visible && Number.isFinite(scale.step) && scale.step > 0)
        consider(Math.round(point[axis] / scale.step) * scale.step, scale.radius);
    }
    return result;
  };
  return { ...point, x: nearest("x"), y: nearest("y") };
}
