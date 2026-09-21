import type { Point } from "./document";
import { CurvePath, flatten } from "./curves";

/**
 * A brush applied to a vector path, as the Paintbrush draws it. The brush is a
 * calligraphic nib: an ellipse of a given diameter, flattened by its roundness and turned
 * by its angle, swept along the path. The path stays an editable Bezier path; the brush
 * only decides how its stroke is painted. The stroke weight of the layer scales the
 * brush, so a weight of 1 paints it at its own diameter.
 */
export interface BrushStroke {
  kind: "calligraphic";
  /** Angle of the nib in degrees, -180 to 180. */
  angle: number;
  /** Roundness of the nib in percent, 0 (flat) to 100 (round). */
  roundness: number;
  /** Diameter of the nib in pixels, 0.1 to 1296. */
  diameter: number;
}
export const DEFAULT_BRUSH_STROKE: Readonly<BrushStroke> = { kind: "calligraphic", angle: 0, roundness: 100, diameter: 3 };
export const BRUSH_STROKE_LIMITS = { angle: [-180, 180], roundness: [0, 100], diameter: [0.1, 1296] } as const;

export function validBrushStroke(value: unknown): value is BrushStroke {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 4 || v["kind"] !== "calligraphic") return false;
  const within = (key: "angle" | "roundness" | "diameter") => {
    const n = v[key], [min, max] = BRUSH_STROKE_LIMITS[key];
    return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  };
  return within("angle") && within("roundness") && within("diameter");
}

/** Half the width the nib paints across a direction of travel, in the units of the path. */
export function nibHalfWidth(brush: BrushStroke, direction: Point, weight = 1): number {
  const a = (brush.diameter * weight) / 2;
  const b = Math.max(a * (brush.roundness / 100), a * 0.02);
  const phi = (brush.angle * Math.PI) / 180;
  const length = Math.hypot(direction.x, direction.y) || 1;
  // The normal of the travel direction, measured against the axes of the nib.
  const nx = -direction.y / length, ny = direction.x / length;
  const along = nx * Math.cos(phi) + ny * Math.sin(phi);
  const across = -nx * Math.sin(phi) + ny * Math.cos(phi);
  return Math.sqrt(a * a * along * along + b * b * across * across);
}

/** The outline of the nib itself, which caps both ends of an open brushed path. */
export function nibOutline(brush: BrushStroke, at: Point, weight = 1, steps = 24): Point[] {
  const a = (brush.diameter * weight) / 2;
  const b = Math.max(a * (brush.roundness / 100), a * 0.02);
  const phi = (brush.angle * Math.PI) / 180;
  return Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * Math.PI * 2;
    const x = Math.cos(t) * a, y = Math.sin(t) * b;
    return { x: at.x + x * Math.cos(phi) - y * Math.sin(phi), y: at.y + x * Math.sin(phi) + y * Math.cos(phi) };
  });
}

const signedArea = (ring: Point[]) => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p.x * q.y - q.x * p.y;
}, 0) / 2;
const oriented = (ring: Point[], positive: boolean) => ((signedArea(ring) >= 0) === positive ? ring : [...ring].reverse());

/**
 * The area a brush paints along a path, as rings to fill with the nonzero rule: the band
 * swept by the nib plus the nib at each end of an open path. A closed path gives an outer
 * and an inner ring, wound the opposite way so the inside stays empty.
 */
export function brushOutline(path: CurvePath, brush: BrushStroke, weight = 1, steps = 16): Point[][] {
  const points = flatten(path, steps).filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-6);
  if (points.length < 2) return points.length ? [nibOutline(brush, points[0], weight)] : [];
  const closed = path.closed && Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) < 1e-6;
  if (closed) points.pop();
  const count = points.length;
  const left: Point[] = [], right: Point[] = [];
  for (let i = 0; i < count; i++) {
    const prev = points[closed ? (i - 1 + count) % count : Math.max(0, i - 1)];
    const next = points[closed ? (i + 1) % count : Math.min(count - 1, i + 1)];
    const direction = { x: next.x - prev.x, y: next.y - prev.y };
    const length = Math.hypot(direction.x, direction.y) || 1;
    const w = nibHalfWidth(brush, direction, weight);
    const nx = -direction.y / length, ny = direction.x / length;
    left.push({ x: points[i].x + nx * w, y: points[i].y + ny * w });
    right.push({ x: points[i].x - nx * w, y: points[i].y - ny * w });
  }
  if (closed) return [oriented(left, true), oriented(right, false)].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a))).map((ring, i) => oriented(ring, i === 0));
  const band = oriented([...left, ...right.reverse()], true);
  return [band, oriented(nibOutline(brush, points[0], weight), true), oriented(nibOutline(brush, points[count - 1], weight), true)];
}

/** SVG path data for the rings of a brushed path. */
export function brushOutlineSvg(rings: Point[][]): string {
  return rings.map((ring) => ring.length ? `M ${ring.map((p) => `${round(p.x)} ${round(p.y)}`).join(" L ")} Z` : "").join(" ");
}
const round = (n: number) => Math.round(n * 1000) / 1000;
